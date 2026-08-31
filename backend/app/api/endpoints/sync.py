from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional, List
from datetime import datetime, timedelta
import os
import logging
import re
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.core.database import get_db, SessionLocal
from app.core.config import settings
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user
from app.models.models import (
    User, UserRole, GmailAccount, BankEmail, PDFStatement, Transaction, Bank, BankConfig, SyncLog, SyncSchedule
)
from app.schemas.bank import SyncRequest, SyncResponse
from app.services.gmail_service import GmailService
from app.services.pdf_parser import PDFParser
from app.services.password_service import get_password_candidates, parse_with_passwords, save_password_candidates
from app.services.transaction_service import TransactionService
from app.services.discord_notifier import discord_notifier
from app.services.pdf_storage import get_preferred_pdf_path, ensure_decrypted_with_candidates, ensure_decrypted_pdf
from app.services.balance_service import apply_statement_balance
from app.services import ai_transaction_extraction, reward_points_service, investment_service
from app.services.transaction_hooks import apply_auto_rules_and_notify, create_or_reconcile_transaction

router = APIRouter()
logger = logging.getLogger(__name__)


def _celery_worker_available(timeout: float = 1.0) -> bool:
    """Return True only if at least one Celery worker answers a ping.

    This distinguishes "broker up but no worker consuming" (task would hang forever)
    from a genuinely available worker, so the caller can fall back to in-process
    execution instead of silently enqueueing a task nobody runs.
    """
    try:
        from app.core.celery_app import celery_app
        replies = celery_app.control.ping(timeout=timeout)
        return bool(replies)
    except Exception as exc:
        logger.warning("Celery worker ping failed: %s", exc)
        return False


STALE_SYNC_MINUTES = 30  # a real sync can't outlive the Celery hard time-limit (30m)


def reap_stale_syncs(db, minutes: int = STALE_SYNC_MINUTES) -> int:
    """Mark syncs stuck in queued/processing past the time limit as failed.

    A backend/worker restart or a task killed at the time-limit can leave a SyncLog stuck
    in 'processing' forever; this reconciles those so the UI doesn't show a phantom
    'sync in progress'. Returns the number reaped."""
    cutoff = utcnow() - timedelta(minutes=minutes)
    stale = db.query(SyncLog).filter(
        SyncLog.status.in_(["processing", "queued"]),
        SyncLog.started_at < cutoff,
    ).all()
    for s in stale:
        s.status = "failed"
        s.error_message = (s.error_message or "") + " · Interrupted (stale job auto-reaped)"
        s.completed_at = utcnow()
        s.current_step = "Interrupted"
    if stale:
        db.commit()
    return len(stale)


def _process_pdf_task(
    pdf_statement_id: int,
    bank_id: int,
    user_id: int,
) -> dict:
    """Worker: parse a saved PDF and persist transactions. Runs in a thread pool.
    Uses its own DB session so it is safe to call from multiple threads.
    """
    db = SessionLocal()
    try:
        pdf_statement = db.query(PDFStatement).filter(PDFStatement.id == pdf_statement_id).first()
        if not pdf_statement:
            return {"pdf_id": pdf_statement_id, "success": False, "error": "PDF not found"}

        bank = db.query(Bank).filter(Bank.id == bank_id).first()
        if not bank:
            return {"pdf_id": pdf_statement_id, "success": False, "error": "Bank not found"}

        field_mapping = json.loads(bank.field_mapping) if bank.field_mapping else None
        pdf_path = pdf_statement.file_path
        is_protected = pdf_statement.is_password_protected

        preferred_path = get_preferred_pdf_path(pdf_statement)
        has_decrypted = bool(pdf_statement.decrypted_path and os.path.exists(pdf_statement.decrypted_path))

        if is_protected and not has_decrypted:
            candidates = get_password_candidates(db, bank)
            parse_result, used_password = parse_with_passwords(
                pdf_path=pdf_path,
                bank_code=bank.code,
                passwords=candidates,
                field_mapping=field_mapping,
            )
            if parse_result.get("success") and used_password and used_password != bank.account_password:
                bank.account_password = used_password
                db.commit()
            ensure_decrypted_with_candidates(db, pdf_statement, candidates)
            if used_password:
                ensure_decrypted_pdf(db, pdf_statement, used_password)
        else:
            parse_result = PDFParser.parse_statement(
                preferred_path or pdf_path,
                bank_code=bank.code,
                password=None,
                field_mapping=field_mapping,
            )
            if not parse_result.get("success") and is_protected:
                candidates = get_password_candidates(db, bank)
                if candidates:
                    parse_result, used_password = parse_with_passwords(
                        pdf_path=pdf_path,
                        bank_code=bank.code,
                        passwords=candidates,
                        field_mapping=field_mapping,
                    )
                    if parse_result.get("success") and used_password and used_password != bank.account_password:
                        bank.account_password = used_password
                        db.commit()

        if not parse_result.get("success"):
            err = parse_result.get("error", "Unknown parse error")
            try:
                pdf_statement.error_message = str(err)[:1000]
                db.commit()
            except Exception:
                db.rollback()
            return {
                "pdf_id": pdf_statement_id,
                "success": False,
                "error": err,
            }

        # Delete existing transactions for this PDF before re-adding
        db.query(Transaction).filter(Transaction.pdf_statement_id == pdf_statement.id).delete()

        pdf_statement.statement_period_start = parse_result["statement_period"]["start"]
        pdf_statement.statement_period_end = parse_result["statement_period"]["end"]
        pdf_statement.is_processed = True
        pdf_statement.error_message = None

        if bank.bank_type == "investment":
            parse_result["transactions"] = []
        else:
            # Parser found nothing at all — try the AI fallback before giving up.
            ai_transaction_extraction.fill_missing_transactions(db, user_id, parse_result)

        transactions_added = 0
        for trans_data in parse_result["transactions"]:
            if not trans_data.get("category"):
                from app.services.categorization import resolve_category
                trans_data["category"] = resolve_category(db, user_id, trans_data["description"])
            transaction, _reconciled = create_or_reconcile_transaction(
                db, user_id, bank.id, trans_data, pdf_statement_id=pdf_statement.id, source="pdf"
            )
            apply_auto_rules_and_notify(db, user_id, transaction)
            transactions_added += 1

        if is_protected and bank.account_password:
            ensure_decrypted_pdf(db, pdf_statement, bank.account_password)

        bank_email = db.query(BankEmail).filter(BankEmail.id == pdf_statement.bank_email_id).first()
        apply_statement_balance(
            bank, parse_result, fallback_date=bank_email.received_date if bank_email else None,
            ai_context={"db": db, "user_id": user_id},
        )
        if bank_email:
            try:
                reward_points_service.record_statement_reward_points(
                    db, bank, pdf_statement.id, parse_result.get("_raw_text"),
                    bank_email.received_date, ai_context={"db": db, "user_id": user_id},
                )
            except Exception:
                logger.warning("Reward-points extraction failed for bank %s", bank.id, exc_info=True)
            try:
                investment_service.record_ppf_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
            except Exception:
                logger.warning("PPF extraction failed for bank %s", bank.id, exc_info=True)
            try:
                investment_service.record_cas_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
            except Exception:
                logger.warning("CAS extraction failed for bank %s", bank.id, exc_info=True)
        db.commit()

        return {
            "pdf_id": pdf_statement_id,
            "success": True,
            "transactions_added": transactions_added,
        }
    except Exception as exc:
        db.rollback()
        logger.error("PDF worker error pdf_id=%s: %s", pdf_statement_id, exc, exc_info=True)
        return {"pdf_id": pdf_statement_id, "success": False, "error": str(exc)}
    finally:
        db.close()

def _run_post_sync_csv(db, user_id: int, generate: bool, email: bool) -> None:
    """Best-effort post-sync CSV generation/email for the user's statement PDFs.

    Only (re)generates CSVs that don't already exist (incremental), and emails the latest
    per bank to the bank's configured csv_email. Never raises — wrapped by caller too."""
    from app.services.csv_service import generate_csv_for_pdf, send_csv_email, _build_csv_path

    banks = db.query(Bank).filter(Bank.user_id == user_id, Bank.is_active == True).all()  # noqa: E712
    for bank in banks:
        be_ids = [be.id for be in db.query(BankEmail).filter(BankEmail.bank_id == bank.id).all()]
        if not be_ids:
            continue
        pdfs = db.query(PDFStatement).filter(
            PDFStatement.bank_email_id.in_(be_ids), PDFStatement.is_processed == True  # noqa: E712
        ).all()
        latest_csv = None
        for pdf in pdfs:
            has_tx = db.query(Transaction.id).filter(Transaction.pdf_statement_id == pdf.id).first()
            if not has_tx:
                continue  # skip non-statement / empty PDFs
            csv_path = _build_csv_path(pdf)
            try:
                if generate and not os.path.exists(csv_path):
                    res = generate_csv_for_pdf(db, pdf, bank)
                    latest_csv = res.get("csv_path") or csv_path
                elif os.path.exists(csv_path):
                    latest_csv = csv_path
            except Exception:
                logger.debug("post-sync CSV generate failed for pdf %s", pdf.id, exc_info=True)
        if email and bank.csv_email and latest_csv and os.path.exists(latest_csv):
            try:
                send_csv_email(bank.csv_email, f"{bank.name} — latest statement CSV",
                               "Automated export from Finance Tracker after sync.", latest_csv)
            except Exception:
                logger.debug("post-sync CSV email failed for bank %s", bank.id, exc_info=True)


def run_sync(
    sync_log_id: int,
    gmail_account_id: Optional[int],
    user_id: int,
    sync_type: str,
    start_date: Optional[datetime],
    bank_id: Optional[int] = None,
):
    """Run a sync job in its own DB session.

    Safe to call from a Celery worker or a FastAPI BackgroundTask (a fresh, dedicated
    session avoids reusing the request-scoped session, which closes when the request ends).
    """
    db = SessionLocal()
    try:
        _run_sync_with_session(sync_log_id, gmail_account_id, user_id, sync_type, start_date, db, bank_id)
    finally:
        db.close()


def _run_sync_with_session(
    sync_log_id: int,
    gmail_account_id: Optional[int],
    user_id: int,
    sync_type: str,
    start_date: Optional[datetime],
    db: Session,
    bank_id: Optional[int] = None,
):
    """Process a sync using the provided DB session."""
    logger = logging.getLogger(__name__)

    sync_log = db.query(SyncLog).filter(SyncLog.id == sync_log_id).first()
    
    try:
        # Get Gmail accounts to sync
        if gmail_account_id:
            gmail_accounts = db.query(GmailAccount).filter(
                GmailAccount.id == gmail_account_id,
                GmailAccount.user_id == user_id
            ).all()
        else:
            gmail_accounts = db.query(GmailAccount).filter(
                GmailAccount.user_id == user_id,
                GmailAccount.is_active == True
            ).all()
        
        if not gmail_accounts:
            sync_log.status = "failed"
            sync_log.error_message = "No active Gmail accounts found. Connect or re-authenticate a Gmail account."
            sync_log.completed_at = utcnow()
            db.commit()
            return

        emails_processed = 0
        transactions_added = 0
        duplicates_found = 0
        sync_errors: List[str] = []

        # Mark as actively processing (distinct from the initial 'queued' state) so the
        # UI can tell "running" from "waiting for a worker".
        sync_log.status = "processing"
        sync_log.current_step = "Starting sync"
        db.commit()

        def _progress(step: Optional[str] = None, bank_name: Optional[str] = None):
            """Persist incremental progress so the live status bar can show x/N + step."""
            if step is not None:
                sync_log.current_step = step
            if bank_name is not None:
                sync_log.current_bank = bank_name
            sync_log.processed_emails = emails_processed
            sync_log.transactions_added = transactions_added
            try:
                db.commit()
            except Exception:
                db.rollback()

        # Process each Gmail account
        for account in gmail_accounts:
            logger.info(f"Processing Gmail account: {account.email}")
            _progress(step=f"Connecting to {account.email}")

            # Initialize Gmail service with credentials from database
            gmail_service = GmailService()
            
            # Set credentials from database
            import json
            creds_dict = json.loads(account.credentials) if isinstance(account.credentials, str) else account.credentials
            if not creds_dict:
                # decrypt_value now returns None for undecryptable data instead of raw
                # ciphertext — treat as needing re-auth rather than crashing.
                logger.error("No usable stored credentials for %s (decrypt failed?)", account.email)
                sync_errors.append(f"{account.email}: stored credentials unreadable, re-authentication required")
                continue

            from app.services.gmail_service import credentials_from_dict
            creds = credentials_from_dict(creds_dict)

            if not gmail_service.authenticate_with_credentials(creds):
                logger.error(f"Failed to authenticate Gmail account: {account.email}")
                sync_errors.append(f"{account.email}: authentication failed")
                continue

            refreshed = gmail_service.get_refreshed_credentials_dict()
            if refreshed:
                account.credentials = json.dumps(refreshed)
                db.commit()
                logger.info("Persisted refreshed OAuth token for %s", account.email)

            # Get banks — scoped to THIS user (never process another user's banks).
            banks_q = db.query(Bank).filter(
                Bank.user_id == user_id,
                Bank.is_active == True
            )
            if bank_id:  # per-bank sync (e.g. the Sync button on one bank card)
                banks_q = banks_q.filter(Bank.id == bank_id)
            banks = banks_q.all()
            logger.info("Sync banks count=%s (bank_id=%s)", len(banks), bank_id)
            
            email_regex = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)

            def parse_email_list(raw_value: Optional[str], allow_patterns: bool = False) -> List[str]:
                if not raw_value:
                    return []
                items = []
                try:
                    import json
                    parsed = json.loads(raw_value)
                    if isinstance(parsed, list):
                        items = [str(e) for e in parsed]
                    elif isinstance(parsed, str):
                        items = [parsed]
                except Exception:
                    items = [e.strip() for e in re.split(r'[;,\n]+', raw_value) if e.strip()]

                cleaned: List[str] = []
                for item in items:
                    text = str(item).strip()
                    if not text:
                        continue
                    if allow_patterns and any(ch in text for ch in ['*', '?']):
                        cleaned.append(text)
                        continue
                    matches = email_regex.findall(text)
                    if matches:
                        cleaned.extend(matches)
                    elif allow_patterns:
                        cleaned.append(text)
                return cleaned

            def get_sender_emails(bank: Bank) -> List[str]:
                emails: List[str] = []
                if bank.sender_email:
                    emails.extend(parse_email_list(bank.sender_email, allow_patterns=False))
                if bank.sender_emails:
                    emails.extend(parse_email_list(bank.sender_emails, allow_patterns=False))

                # Only fall back to BankConfig patterns when the bank has NO direct sender
                # email configured — and skip bare wildcards ('*') which match everything.
                if not emails:
                    configs = db.query(BankConfig).filter(BankConfig.bank_id == bank.id).all()
                    for config in configs:
                        pattern = (config.email_pattern or '').strip()
                        if pattern and pattern != '*':
                            emails.extend(parse_email_list(pattern, allow_patterns=True))

                # Normalize and dedupe
                cleaned = []
                seen = set()
                for email in emails:
                    email = str(email).strip()
                    if not email:
                        continue
                    if email in seen:
                        continue
                    seen.add(email)
                    cleaned.append(email)
                return cleaned

            for bank in banks:
                logger.info("Evaluating bank=%s id=%s", bank.name, bank.id)
                sender_emails = get_sender_emails(bank)
                if not sender_emails:
                    logger.info("No sender emails configured for bank=%s", bank.name)
                    continue

                logger.info(f"Sender emails for {bank.name}: {sender_emails}")

                for sender_email in sender_emails:
                    logger.info(f"Processing bank: {bank.name} with email: {sender_email}")
                    logger.info(
                        "Gmail query context bank=%s sender=%s start_date=%s",
                        bank.name,
                        sender_email,
                        start_date.isoformat() if start_date else "none"
                    )
                    
                    # Search for bank emails
                    try:
                        query_str = f"from:{sender_email} has:attachment filename:pdf"
                        logger.info("Gmail query=%s", query_str)
                        messages = gmail_service.search_messages(
                            query=query_str,
                            after_date=start_date,
                            max_results=100
                        )
                    except Exception as e:
                        error_text = str(e)
                        logger.error(f"Failed Gmail search for {account.email}: {error_text}")
                        # Only a genuine invalid_grant means the grant is dead and the
                        # account must be re-authenticated. Transient errors (429/5xx/
                        # network) must NOT deactivate the account or fail the whole sync.
                        if 'invalid_grant' in error_text:
                            account.is_active = False
                            db.commit()
                            sync_log.status = "failed"
                            sync_log.error_message = "Gmail authorization expired. Please re-authenticate."
                            sync_log.completed_at = utcnow()
                            db.commit()
                            return
                        sync_errors.append(f"{bank.name}/{sender_email}: {error_text[:200]}")
                        continue
                    
                    logger.info(f"Found {len(messages)} messages for {bank.name} ({sender_email})")
                    sync_log.total_emails = (sync_log.total_emails or 0) + len(messages)
                    _progress(step=f"Scanning {bank.name}", bank_name=bank.name)
                    if not messages:
                        logger.info(
                            "No PDF messages found for bank=%s sender=%s account=%s",
                            bank.name,
                            sender_email,
                            account.email
                        )
                
                    for message in messages:
                        actual_sender = message.get('sender', '')
                        logger.info(
                            "Gmail message id=%s subject=%s from=%s pdf_attachments=%s",
                            message.get('id'),
                            message.get('subject'),
                            actual_sender,
                            len(message.get('attachments') or [])
                        )

                        # ---- Sender validation (domain-aware, not strict-equality) ----
                        # Gmail's server-side `from:` already matched this message. The
                        # old code additionally required an EXACT address match, which
                        # dropped every message whenever the configured address differed
                        # even slightly from the envelope From (sub-addresses, aliases,
                        # display-name quirks) — the main reason sync "found" mail but
                        # pulled nothing. Now we accept an exact match OR a same-domain
                        # match, which is what Gmail effectively returned anyway.
                        sender_addr_match = email_regex.search(actual_sender)
                        actual_sender_addr = sender_addr_match.group(0).lower() if sender_addr_match else actual_sender.lower()
                        expected_addr = sender_email.lower()

                        if '*' not in expected_addr and '?' not in expected_addr:
                            expected_domain = expected_addr.split('@')[-1]
                            actual_domain = actual_sender_addr.split('@')[-1]
                            if actual_sender_addr != expected_addr and actual_domain != expected_domain:
                                logger.warning(
                                    "SKIPPING message id=%s: sender '%s' domain != expected '%s' (bank=%s)",
                                    message.get('id'), actual_sender_addr, expected_addr, bank.name
                                )
                                continue
                        # ---------------------------------------------------------------

                        try:
                            emails_processed += 1
                            _progress(step=f"Processing email from {bank.name}", bank_name=bank.name)

                            # Check if email already processed
                            existing_email = db.query(BankEmail).filter(
                                BankEmail.email_id == message['id']
                            ).first()

                            if existing_email and existing_email.is_processed:
                                logger.info("Email %s already processed, skipping", message['id'])
                                continue

                            # Create or update bank email record
                            if not existing_email:
                                bank_email = BankEmail(
                                    gmail_account_id=account.id,
                                    bank_id=bank.id,
                                    email_id=message['id'],
                                    subject=message['subject'],
                                    from_email=actual_sender,
                                    received_date=message['date'],
                                    has_attachment=message['has_attachments']
                                )
                                db.add(bank_email)
                                db.commit()
                                db.refresh(bank_email)
                            else:
                                if not existing_email.from_email:
                                    existing_email.from_email = actual_sender
                                    db.commit()
                                bank_email = existing_email

                            # ── Phase 1: Download all PDF attachments to disk (sequential, network I/O) ──
                            pdf_tasks = []  # list of (pdf_statement_id, bank_id)
                            for pdf_idx, attachment in enumerate(message['attachments']):
                                if not attachment['filename'].lower().endswith('.pdf'):
                                    continue

                                # Sanitize filename
                                raw_filename = attachment['filename']
                                filename = os.path.basename(raw_filename.replace('/', '_').replace('\\', '_'))
                                if not filename.lower().endswith('.pdf'):
                                    filename += '.pdf'

                                # Filter by pdf_filename_prefix if set on the bank
                                if bank.pdf_filename_prefix:
                                    prefix_lower = bank.pdf_filename_prefix.strip().lower()
                                    if prefix_lower and not filename.lower().startswith(prefix_lower):
                                        logger.debug(
                                            "Skipping attachment %s — does not match bank '%s' prefix '%s'",
                                            filename, bank.name, bank.pdf_filename_prefix
                                        )
                                        continue

                                # Download PDF
                                pdf_data = gmail_service.get_attachment(
                                    message['id'],
                                    attachment['attachmentId']
                                )
                                if not pdf_data:
                                    logger.warning("No data for attachment %s in message %s", filename, message['id'])
                                    continue

                                # Save PDF to disk
                                os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
                                pdf_filename = f"{bank.code}_{message['id']}_{filename}"
                                pdf_path = os.path.join(settings.UPLOAD_DIR, pdf_filename)
                                with open(pdf_path, 'wb') as f:
                                    f.write(pdf_data)

                                # Check if password protected
                                is_protected = PDFParser.is_password_protected(pdf_path)

                                # Create PDF statement record (lightweight, no parsing yet)
                                pdf_statement = PDFStatement(
                                    bank_email_id=bank_email.id,
                                    file_path=pdf_path,
                                    file_name=filename,
                                    is_password_protected=is_protected
                                )
                                db.add(pdf_statement)
                                db.commit()
                                db.refresh(pdf_statement)
                                pdf_tasks.append((pdf_statement.id, bank.id))
                                logger.info("Downloaded PDF %s → id=%s protected=%s", filename, pdf_statement.id, is_protected)

                            if not pdf_tasks:
                                bank_email.is_processed = True
                                db.commit()
                                continue

                            # ── Phase 2: Parse PDFs in parallel (CPU/IO bound) ──
                            max_workers = max(1, min(settings.MAX_WORKERS, len(pdf_tasks)))
                            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                                futures = {
                                    executor.submit(_process_pdf_task, pdf_id, bk_id, user_id): (pdf_id, bk_id)
                                    for pdf_id, bk_id in pdf_tasks
                                }
                                for future in as_completed(futures):
                                    result = future.result()
                                    if result.get("success"):
                                        transactions_added += result.get("transactions_added", 0)
                                        logger.info(
                                            "PDF id=%s parsed: %d transactions",
                                            result["pdf_id"], result.get("transactions_added", 0)
                                        )
                                    else:
                                        logger.warning(
                                            "PDF id=%s parse failed: %s",
                                            result["pdf_id"], result.get("error")
                                        )

                            # Mark email as processed
                            bank_email.is_processed = True
                            db.commit()

                        except Exception as msg_err:
                            logger.error(
                                "Error processing message id=%s (bank=%s): %s",
                                message.get('id'), bank.name, msg_err, exc_info=True
                            )
                            db.rollback()
            # Update last synced time
            account.last_synced = utcnow()
            db.commit()
        
        _progress(step="Detecting duplicates")

        # Detect duplicates
        all_transactions = db.query(Transaction).filter(
            Transaction.user_id == user_id
        ).all()
        
        trans_dicts = [
            {
                'transaction_date': t.transaction_date,
                'amount': t.amount,
                'description': t.description
            }
            for t in all_transactions
        ]
        
        duplicate_groups = TransactionService.find_duplicates(
            db, user_id, trans_dicts
        )
        duplicates_found = TransactionService.mark_duplicates(db, duplicate_groups)
        
        # Update sync log
        sync_log.emails_processed = emails_processed
        sync_log.processed_emails = emails_processed
        sync_log.transactions_added = transactions_added
        sync_log.duplicates_found = duplicates_found
        # If some senders/accounts failed transiently but others succeeded, report partial.
        if sync_errors:
            sync_log.status = "partial"
            sync_log.error_message = "; ".join(sync_errors[:10])
        else:
            sync_log.status = "success"
        sync_log.current_step = "Completed"
        sync_log.completed_at = utcnow()
        db.commit()

        logger.info(f"Sync completed: {emails_processed} emails, {transactions_added} transactions, {duplicates_found} duplicates, errors={len(sync_errors)}")

        # Budget threshold alerts (once per month per budget) after new data lands.
        try:
            from app.services.budget_service import check_and_alert
            check_and_alert(db, user_id)
        except Exception:
            logger.warning("Budget alert check failed", exc_info=True)

        # ── Post-sync actions, honoring the user's Automation toggles ──
        try:
            sched = db.query(SyncSchedule).filter(SyncSchedule.user_id == user_id).first()
            notify = sched.notify_on_completion if sched else True
            gen_csv = sched.auto_generate_csv if sched else False
            email_csv = sched.csv_email_on_sync if sched else False

            if notify and transactions_added > 0:
                discord_notifier.notify_new_data(bank_name="All Banks", transaction_count=transactions_added)

            if (gen_csv or email_csv) and transactions_added > 0:
                _run_post_sync_csv(db, user_id, generate=gen_csv, email=email_csv)
        except Exception:
            logger.warning("Post-sync actions failed", exc_info=True)

    except Exception as e:
        logger.error(f"Sync error: {e}", exc_info=True)
        sync_log.status = "failed"
        sync_log.error_message = str(e)
        sync_log.completed_at = utcnow()
        db.commit()
        # Discord: notify sync failure
        discord_notifier.notify_error(
            bank_name="Sync Job",
            error_message=str(e),
            operation="Gmail sync"
        )


def dispatch_sync(
    db: Session,
    background_tasks: BackgroundTasks,
    user_id: int,
    sync_type: str = "incremental",
    gmail_account_id: Optional[int] = None,
    bank_id: Optional[int] = None,
    start_date=None,
) -> SyncLog:
    """Create a SyncLog and dispatch it to Celery (falling back to in-process if no
    worker is alive to consume it). Shared by the manual "Sync now" endpoint below
    and any other place that needs to kick off a sync programmatically (e.g.
    auto-starting a sync right after a new bank is created)."""
    sync_log = SyncLog(
        user_id=user_id,
        gmail_account_id=gmail_account_id,
        sync_type=sync_type,
        status="queued",
        current_step="Queued",
    )
    db.add(sync_log)
    db.commit()
    db.refresh(sync_log)

    start_date_iso = start_date.isoformat() if start_date else None
    dispatched_to_worker = False
    if _celery_worker_available():
        try:
            from app.tasks.sync_tasks import run_sync_task
            run_sync_task.apply_async(
                args=[sync_log.id, gmail_account_id, user_id, sync_type, start_date_iso, bank_id],
                retry=False,
            )
            dispatched_to_worker = True
            logger.info("Sync %s dispatched to Celery worker", sync_log.id)
        except Exception as exc:
            logger.warning("Celery dispatch failed (%s); falling back to in-process.", exc)

    if not dispatched_to_worker:
        logger.info("Sync %s running in-process (no Celery worker available)", sync_log.id)
        background_tasks.add_task(
            run_sync, sync_log.id, gmail_account_id, user_id, sync_type, start_date, bank_id,
        )

    return sync_log


@router.post("/", response_model=SyncResponse, status_code=status.HTTP_202_ACCEPTED)
async def sync_transactions(
    sync_request: SyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Sync transactions from Gmail accounts"""
    sync_log = dispatch_sync(
        db, background_tasks, current_user.id,
        sync_type=sync_request.sync_type,
        gmail_account_id=sync_request.gmail_account_id,
        bank_id=sync_request.bank_id,
        start_date=sync_request.start_date,
    )

    return SyncResponse(
        sync_log_id=sync_log.id,
        status=sync_log.status,
        emails_processed=0,
        transactions_added=0,
        duplicates_found=0,
        started_at=sync_log.started_at
    )


@router.get("/recent")
def get_recent_syncs(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Return the most recent sync logs (all users' logs for admin, own for everyone else)."""
    query = db.query(SyncLog)
    if getattr(current_user, "role", None) != UserRole.ADMIN:
        query = query.filter(SyncLog.user_id == current_user.id)
    logs = (
        query
        .order_by(SyncLog.started_at.desc())
        .limit(limit)
        .all()
    )
    return [_sync_log_dict(s) for s in logs]


def _sync_log_dict(s: SyncLog) -> dict:
    """Serialise a SyncLog including live-progress fields, with UTC-marked timestamps
    ('Z' suffix) so the frontend renders the correct local time instead of skewed naive
    values."""
    def _iso_utc(dt):
        return (dt.isoformat() + "Z") if dt else None
    return {
        "sync_log_id": s.id,
        "status": s.status,
        "sync_type": s.sync_type,
        "gmail_email": s.gmail_account.email if s.gmail_account else None,
        "emails_processed": s.emails_processed or 0,
        "transactions_added": s.transactions_added or 0,
        "duplicates_found": s.duplicates_found or 0,
        "total_emails": s.total_emails or 0,
        "processed_emails": s.processed_emails or 0,
        "current_step": s.current_step,
        "current_bank": s.current_bank,
        "started_at": _iso_utc(s.started_at),
        "completed_at": _iso_utc(s.completed_at),
        "error_message": s.error_message,
    }


@router.get("/active")
def get_active_syncs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Return the caller's in-flight syncs (queued/processing) with live progress,
    powering the global sync status bar."""
    query = db.query(SyncLog).filter(SyncLog.status.in_(["queued", "processing"]))
    if getattr(current_user, "role", None) != UserRole.ADMIN:
        query = query.filter(SyncLog.user_id == current_user.id)
    active = query.order_by(SyncLog.started_at.desc()).all()
    return [_sync_log_dict(s) for s in active]


@router.post("/clear-stuck")
def clear_stuck_syncs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Mark the caller's in-flight (queued/processing) syncs as failed — a manual escape
    hatch for jobs that got stuck. Admins clear all users' stuck jobs (incl. orphans)."""
    query = db.query(SyncLog).filter(SyncLog.status.in_(["queued", "processing"]))
    if getattr(current_user, "role", None) != UserRole.ADMIN:
        query = query.filter(SyncLog.user_id == current_user.id)
    rows = query.all()
    for s in rows:
        s.status = "failed"
        s.error_message = (s.error_message or "") + " · Cleared by user"
        s.completed_at = utcnow()
        s.current_step = "Cleared"
    if rows:
        db.commit()
    return {"cleared": len(rows)}


@router.get("/worker-config")
def get_worker_config(
    current_user: User = Depends(get_current_active_user)
):
    """Return threading configuration."""
    import multiprocessing
    return {
        "configured_workers": settings.MAX_WORKERS,
        "cpu_count": multiprocessing.cpu_count(),
    }


@router.get("/status/{sync_log_id}")
def get_sync_status(
    sync_log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get sync status (own logs only; admins may read any)."""
    query = db.query(SyncLog).filter(SyncLog.id == sync_log_id)
    if getattr(current_user, "role", None) != UserRole.ADMIN:
        # Prevent IDOR: a non-admin may only read their own sync logs.
        query = query.filter(SyncLog.user_id == current_user.id)
    sync_log = query.first()

    if not sync_log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync log not found"
        )

    return _sync_log_dict(sync_log)


@router.post("/resync-pdfs")
def resync_pdfs(
    bank_id: Optional[int] = None,
    force_all: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Resync all PDFs or PDFs for a specific bank
    
    Args:
        bank_id: Optional bank ID to resync only that bank's PDFs
        force_all: If True, resync all PDFs. If False, only resync unprocessed ones
    """
    # Get GmailAccounts for the user
    gmail_accounts = db.query(GmailAccount).filter(
        GmailAccount.user_id == current_user.id
    ).all()
    
    gmail_account_ids = [ga.id for ga in gmail_accounts]
    
    # Get BankEmails
    bank_emails_query = db.query(BankEmail).filter(
        BankEmail.gmail_account_id.in_(gmail_account_ids)
    )
    
    if bank_id:
        bank_emails_query = bank_emails_query.filter(BankEmail.bank_id == bank_id)
    
    bank_email_ids = [be.id for be in bank_emails_query.all()]
    
    # Get PDFStatements
    query = db.query(PDFStatement).filter(
        PDFStatement.bank_email_id.in_(bank_email_ids)
    )
    
    if not force_all:
        query = query.filter(PDFStatement.is_processed == False)
    
    pdf_statements = query.all()
    
    if not pdf_statements:
        return {
            "success": True,
            "pdfs_processed": 0,
            "transactions_added": 0,
            "total_pdfs": 0,
            "errors": [],
            "message": "No PDFs found to resync"
        }
    
    # Send Discord notification - sync started
    try:
        bank_name = "All Banks" if not bank_id else db.query(Bank).get(bank_id).name
        discord_notifier.notify_sync_started(bank_name)
    except Exception as e:
        logger.warning(f"Failed to send Discord notification: {e}")
    
    transactions_added = 0
    pdfs_processed = 0
    errors = []
    
    for pdf_statement in pdf_statements:
        try:
            bank_email = db.query(BankEmail).filter(BankEmail.id == pdf_statement.bank_email_id).first()
            if not bank_email:
                continue
                
            bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
            if not bank:
                continue
            
            logger.info(f"Resyncing PDF: {pdf_statement.file_name} bank={bank.name}")
            
            # Check if password protected
            is_protected = PDFParser.is_password_protected(pdf_statement.file_path)
            
            # Use the bank's own code directly (don't guess from name)
            bank_code = bank.code if bank.code else None
            
            import json
            field_mapping = json.loads(bank.field_mapping) if bank.field_mapping else None
            preferred_path = get_preferred_pdf_path(pdf_statement)
            if is_protected and (not preferred_path or not os.path.exists(preferred_path)):
                candidates = get_password_candidates(db, bank)
                parse_result, used_password = parse_with_passwords(
                    pdf_path=pdf_statement.file_path,
                    bank_code=bank_code,
                    passwords=candidates,
                    field_mapping=field_mapping
                )
                if parse_result.get('success') and used_password and used_password != bank.account_password:
                    bank.account_password = used_password
                    db.commit()
                ensure_decrypted_with_candidates(db, pdf_statement, candidates)
                if used_password:
                    ensure_decrypted_pdf(db, pdf_statement, used_password)
            else:
                parse_result = PDFParser.parse_statement(
                    pdf_path=preferred_path or pdf_statement.file_path,
                    bank_code=bank_code,
                    password=None,
                    field_mapping=field_mapping
                )
            
            logger.info(f"Parse result - Success: {parse_result['success']}, Transactions: {len(parse_result.get('transactions', []))}")
            
            if parse_result['success']:
                # Remove old transactions if reprocessing
                if force_all:
                    db.query(Transaction).filter(
                        Transaction.pdf_statement_id == pdf_statement.id
                    ).delete()
                
                # Update statement period
                pdf_statement.statement_period_start = parse_result['statement_period']['start']
                pdf_statement.statement_period_end = parse_result['statement_period']['end']
                pdf_statement.is_processed = True

                if bank.bank_type == "investment":
                    parse_result["transactions"] = []
                else:
                    # Parser found nothing at all — try the AI fallback before giving up.
                    ai_transaction_extraction.fill_missing_transactions(db, current_user.id, parse_result)

                # Add transactions
                for trans_data in parse_result['transactions']:
                    # Auto-categorize -- user's own CategoryRule keywords first
                    if not trans_data.get('category'):
                        from app.services.categorization import resolve_category
                        trans_data['category'] = resolve_category(db, current_user.id, trans_data['description'])

                    transaction, _reconciled = create_or_reconcile_transaction(
                        db, current_user.id, bank.id, trans_data, pdf_statement_id=pdf_statement.id
                    )
                    apply_auto_rules_and_notify(db, current_user.id, transaction)
                    transactions_added += 1

                if is_protected and bank.account_password:
                    ensure_decrypted_pdf(db, pdf_statement, bank.account_password)
                apply_statement_balance(
                    bank, parse_result, fallback_date=bank_email.received_date,
                    ai_context={"db": db, "user_id": current_user.id},
                )
                try:
                    reward_points_service.record_statement_reward_points(
                        db, bank, pdf_statement.id, parse_result.get("_raw_text"),
                        bank_email.received_date, ai_context={"db": db, "user_id": current_user.id},
                    )
                except Exception:
                    logger.warning("Reward-points extraction failed for bank %s", bank.id, exc_info=True)
                try:
                    investment_service.record_ppf_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
                except Exception:
                    logger.warning("PPF extraction failed for bank %s", bank.id, exc_info=True)
                try:
                    investment_service.record_cas_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
                except Exception:
                    logger.warning("CAS extraction failed for bank %s", bank.id, exc_info=True)
                db.commit()
                pdfs_processed += 1
                logger.info(f"Saved {len(parse_result['transactions'])} transactions from {pdf_statement.file_name}")
                
                # Send Discord notification - new data obtained
                try:
                    discord_notifier.notify_new_data(
                        bank_name=bank.name,
                        transaction_count=len(parse_result['transactions']),
                        pdf_file=pdf_statement.file_name
                    )
                except Exception as e:
                    logger.warning(f"Failed to send Discord notification: {e}")
            else:
                error_msg = f"Failed to parse {pdf_statement.file_name}: {parse_result.get('error', 'Unknown error')}"
                logger.warning(error_msg)
                errors.append(error_msg)
                
                # Send Discord notification - error
                try:
                    discord_notifier.notify_error(
                        bank_name=bank.name,
                        error_message=parse_result.get('error', 'Unknown error'),
                        operation="PDF Parsing"
                    )
                except Exception as e:
                    logger.warning(f"Failed to send Discord notification: {e}")
                
        except Exception as e:
            error_msg = f"Error processing {pdf_statement.file_name}: {str(e)}"
            logger.error(error_msg)
            errors.append(error_msg)
            
            # Send Discord notification - error
            try:
                discord_notifier.notify_error(
                    bank_name=bank.name if bank else "Unknown",
                    error_message=str(e),
                    operation="PDF Processing"
                )
            except Exception as e2:
                logger.warning(f"Failed to send Discord notification: {e2}")
            continue
    
    # Send Discord notification - sync completed
    try:
        bank_name = "All Banks" if not bank_id else db.query(Bank).get(bank_id).name
        total_transactions = db.query(Transaction).filter(Transaction.user_id == current_user.id).count()
        discord_notifier.notify_sync_completed(
            bank_name=bank_name,
            new_transactions=transactions_added,
            total_transactions=total_transactions
        )
    except Exception as e:
        logger.warning(f"Failed to send Discord notification: {e}")
    
    return {
        "success": True,
        "pdfs_processed": pdfs_processed,
        "transactions_added": transactions_added,
        "total_pdfs": len(pdf_statements),
        "errors": errors
    }


@router.post("/test-pdf-password")
def test_pdf_password(
    pdf_id: int,
    password: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Test if a password can unlock a PDF"""
    # Get PDF statement
    pdf_statement = db.query(PDFStatement).filter(PDFStatement.id == pdf_id).first()
    if not pdf_statement:
        raise HTTPException(status_code=404, detail="PDF not found")
    
    # Verify ownership
    bank_email = db.query(BankEmail).filter(BankEmail.id == pdf_statement.bank_email_id).first()
    if not bank_email:
        raise HTTPException(status_code=404, detail="Bank email not found")
    
    gmail_account = db.query(GmailAccount).filter(GmailAccount.id == bank_email.gmail_account_id).first()
    if not gmail_account or gmail_account.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Test password
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
        tmp_path = tmp.name
    
    success = PDFParser.unlock_pdf(pdf_statement.file_path, password, tmp_path)
    
    if success:
        # Password works, try to parse
        bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
        bank_code = None
        if bank and bank.name:
            bank_name_lower = bank.name.lower()
            if 'hdfc' in bank_name_lower:
                bank_code = 'hdfc'
            elif 'yes' in bank_name_lower:
                bank_code = 'yes'
            elif 'icici' in bank_name_lower:
                bank_code = 'icici'
            elif 'sbi' in bank_name_lower:
                bank_code = 'sbi'
            elif 'axis' in bank_name_lower:
                bank_code = 'axis'
        
        parse_result = PDFParser.parse_statement(
            pdf_path=pdf_statement.file_path,
            bank_code=bank_code,
            password=password
        )
        
        os.unlink(tmp_path)
        
        return {
            "success": True,
            "password_works": True,
            "transactions_found": len(parse_result.get('transactions', [])),
            "can_parse": parse_result['success']
        }
    else:
        os.unlink(tmp_path)
        return {
            "success": False,
            "password_works": False,
            "message": "Invalid password"
        }


@router.post("/update-pdf-password")
def update_pdf_password(
    pdf_id: int,
    password: str,
    apply_to_bank: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Update password for a PDF and optionally for all PDFs from same bank"""
    # Get PDF statement
    pdf_statement = db.query(PDFStatement).filter(PDFStatement.id == pdf_id).first()
    if not pdf_statement:
        raise HTTPException(status_code=404, detail="PDF not found")
    
    # Verify ownership
    bank_email = db.query(BankEmail).filter(BankEmail.id == pdf_statement.bank_email_id).first()
    if not bank_email:
        raise HTTPException(status_code=404, detail="Bank email not found")
    
    gmail_account = db.query(GmailAccount).filter(GmailAccount.id == bank_email.gmail_account_id).first()
    if not gmail_account or gmail_account.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")

    # Always remember the password as a bank candidate (so future syncs can reuse it);
    # only set it as the bank's PRIMARY password when the user opts in.
    try:
        save_password_candidates(db, bank, [password])
    except Exception:
        db.rollback()
    if apply_to_bank:
        bank.account_password = password
        db.commit()

    # Always parse+process THIS pdf with the given password, using the bank's real code
    # and field mapping (not a hardcoded name guess). This works whether or not the
    # password is applied bank-wide — previously it was a silent no-op when unchecked.
    import json as _json
    field_mapping = _json.loads(bank.field_mapping) if bank.field_mapping else None
    parse_result = PDFParser.parse_statement(
        pdf_path=pdf_statement.file_path,
        bank_code=bank.code,
        password=password,
        field_mapping=field_mapping,
    )

    if not parse_result.get("success"):
        pdf_statement.error_message = str(parse_result.get("error", "Invalid password or unparseable PDF"))[:1000]
        db.commit()
        return {"success": False, "message": parse_result.get("error", "Failed to parse PDF with this password")}

    db.query(Transaction).filter(Transaction.pdf_statement_id == pdf_statement.id).delete()
    pdf_statement.statement_period_start = parse_result["statement_period"]["start"]
    pdf_statement.statement_period_end = parse_result["statement_period"]["end"]
    pdf_statement.is_processed = True
    pdf_statement.error_message = None
    try:
        ensure_decrypted_pdf(db, pdf_statement, password)
    except Exception:
        logger.debug("ensure_decrypted_pdf failed", exc_info=True)

    if bank.bank_type == "investment":
        parse_result["transactions"] = []
    else:
        # Parser found nothing at all — try the AI fallback before giving up.
        ai_transaction_extraction.fill_missing_transactions(db, current_user.id, parse_result)

    transactions_added = 0
    for trans_data in parse_result["transactions"]:
        if not trans_data.get("category"):
            from app.services.categorization import resolve_category
            trans_data["category"] = resolve_category(db, current_user.id, trans_data["description"])
        transaction, _reconciled = create_or_reconcile_transaction(
            db, current_user.id, bank.id, trans_data, pdf_statement_id=pdf_statement.id, source="pdf"
        )
        apply_auto_rules_and_notify(db, current_user.id, transaction)
        transactions_added += 1
    apply_statement_balance(
        bank, parse_result, fallback_date=bank_email.received_date,
        ai_context={"db": db, "user_id": current_user.id},
    )
    try:
        reward_points_service.record_statement_reward_points(
            db, bank, pdf_statement.id, parse_result.get("_raw_text"),
            bank_email.received_date, ai_context={"db": db, "user_id": current_user.id},
        )
    except Exception:
        logger.warning("Reward-points extraction failed for bank %s", bank.id, exc_info=True)
    try:
        investment_service.record_ppf_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
    except Exception:
        logger.warning("PPF extraction failed for bank %s", bank.id, exc_info=True)
    try:
        investment_service.record_cas_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
    except Exception:
        logger.warning("CAS extraction failed for bank %s", bank.id, exc_info=True)
    db.commit()

    return {
        "success": True,
        "message": f"Processed {transactions_added} transactions." + (" Password applied to bank." if apply_to_bank else ""),
        "transactions_added": transactions_added,
        "applied_to_bank": apply_to_bank,
    }
