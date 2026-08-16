"""Credit-card reward/loyalty points ledger.

Balance is always the sum of every RewardPointEntry.points for a bank -- there
is no separate mutable balance column to drift out of sync. Manual entries
(earned/redeemed/expired) are the reliable source for expiry-dated batches,
since statements essentially never print a per-batch expiry date; a
statement-derived entry only ever reconciles the running TOTAL to what the
issuer's PDF prints (source='auto'/'ai', entry_type='adjustment', no expiry).
"""
import logging
from datetime import timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.time_utils import utcnow
from app.models.models import Bank, RewardPointEntry

logger = logging.getLogger(__name__)

# Warn this many days before an earned batch expires. Sorted descending so the
# daily check can find the single highest threshold newly crossed today.
EXPIRY_WARNING_DAYS = (30, 7, 1)


def list_entries(db: Session, user_id: int, bank_id: Optional[int] = None) -> List[RewardPointEntry]:
    q = db.query(RewardPointEntry).filter(RewardPointEntry.user_id == user_id)
    if bank_id is not None:
        q = q.filter(RewardPointEntry.bank_id == bank_id)
    return q.order_by(RewardPointEntry.created_at.desc()).all()


def bank_summary(db: Session, bank: Bank) -> dict:
    """{bank_id, bank_name, balance, expiring: [{expiry_date, points}], next_expiry_date}."""
    entries = (
        db.query(RewardPointEntry)
        .filter(RewardPointEntry.bank_id == bank.id, RewardPointEntry.user_id == bank.user_id)
        .all()
    )
    balance = sum(e.points for e in entries)

    now = utcnow()
    upcoming = sorted(
        (e for e in entries if e.entry_type == "earned" and e.expiry_date and e.expiry_date > now),
        key=lambda e: e.expiry_date,
    )
    # Points "at risk" can't exceed what's actually left in the account -- a
    # later redemption may already have used up an earlier, soon-expiring
    # batch, and there's no per-batch FIFO consumption tracking to know for
    # sure, so this is a conservative cap rather than a precise per-batch figure.
    remaining_cap = max(0.0, balance)
    expiring = []
    for e in upcoming:
        if remaining_cap <= 0:
            break
        amount = min(e.points, remaining_cap)
        remaining_cap -= amount
        expiring.append({"expiry_date": e.expiry_date.isoformat(), "points": amount, "entry_id": e.id})

    return {
        "bank_id": bank.id,
        "bank_name": bank.name,
        "balance": balance,
        "expiring": expiring,
        "next_expiry_date": upcoming[0].expiry_date.isoformat() if upcoming else None,
    }


def all_bank_summaries(db: Session, user_id: int) -> List[dict]:
    banks = db.query(Bank).filter(Bank.user_id == user_id, Bank.bank_type == "credit").all()
    return [bank_summary(db, b) for b in banks]


def monthly_summary(db: Session, user_id: int, bank_id: Optional[int] = None, months: int = 12) -> List[dict]:
    """Per-month {month: 'YYYY-MM', gained, used, expired, net}, most recent
    first. Grouped by entry_date (the statement's own cycle date for auto/ai
    entries, falling back to created_at for legacy rows and manual entries).

    'gained'/'used'/'expired' come straight from earned/redeemed/expired
    entries when a statement's breakdown was extractable. For a bank/month
    where only a lump 'adjustment' entry exists (no breakdown available, or a
    manual entry of that type), its net delta is counted as gained (if
    positive) or used (if negative) -- there's no way to tell "used" from
    "expired" for an un-broken-down adjustment.
    """
    q = db.query(RewardPointEntry).filter(RewardPointEntry.user_id == user_id)
    if bank_id is not None:
        q = q.filter(RewardPointEntry.bank_id == bank_id)
    entries = q.all()

    buckets: dict = {}
    for e in entries:
        d = e.entry_date or e.created_at
        if not d:
            continue
        key = d.strftime("%Y-%m")
        b = buckets.setdefault(key, {"month": key, "gained": 0.0, "used": 0.0, "expired": 0.0, "net": 0.0})
        b["net"] += e.points
        if e.entry_type == "earned":
            b["gained"] += e.points
        elif e.entry_type == "redeemed":
            b["used"] += -e.points
        elif e.entry_type == "expired":
            b["expired"] += -e.points
        elif e.points > 0:
            b["gained"] += e.points
        else:
            b["used"] += -e.points

    ordered = sorted(buckets.values(), key=lambda b: b["month"], reverse=True)
    return ordered[:months]


def create_entry(
    db: Session, user_id: int, bank_id: int, entry_type: str, points: float,
    expiry_date=None, description: Optional[str] = None,
) -> RewardPointEntry:
    signed = points if entry_type in ("earned",) else -abs(points) if entry_type in ("redeemed", "expired") else points
    now = utcnow()
    entry = RewardPointEntry(
        user_id=user_id, bank_id=bank_id, entry_type=entry_type, points=signed,
        expiry_date=expiry_date if entry_type == "earned" else None,
        entry_date=now, description=description, source="manual",
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def delete_entry(db: Session, user_id: int, entry_id: int) -> bool:
    entry = db.query(RewardPointEntry).filter(
        RewardPointEntry.id == entry_id, RewardPointEntry.user_id == user_id
    ).first()
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    return True


def record_statement_reward_points(
    db: Session, bank: Bank, pdf_statement_id: Optional[int], text: str,
    statement_date, ai_context: Optional[dict] = None,
) -> Optional[RewardPointEntry]:
    """Best-effort: extract this statement's printed reward-points activity and
    reconcile the ledger's running total to it, tagging every entry with this
    statement's own cycle date (statement_date) so the monthly gained/used/
    expired view groups it into the right month even when processed later.

    When the statement prints a per-cycle breakdown (opening/earned/disbursed/
    adjusted-lapsed -- see PDFParser.extract_reward_points_breakdown), records
    separate 'earned'/'redeemed'/'expired' entries for it plus a small residual
    'adjustment' entry for whatever gap remains versus the closing total (so the
    running balance always matches the issuer's printed figure exactly, even if
    the breakdown regex is imperfect). Otherwise falls back to a single
    'adjustment' entry for the whole delta, same as before.

    Returns the last entry created, or None if nothing was extracted, the
    statement is older than what's already reconciled, or a reconciliation
    entry already exists for this statement. Never raises -- callers treat this
    as non-critical, same as apply_statement_balance's own AI fallback.
    """
    if (getattr(bank, "bank_type", "") or "").lower() != "credit":
        return None
    if not text or statement_date is None:
        return None
    if bank.reward_points_updated_at and statement_date <= bank.reward_points_updated_at:
        return None
    if pdf_statement_id and db.query(RewardPointEntry.id).filter(
        RewardPointEntry.pdf_statement_id == pdf_statement_id
    ).first():
        return None

    from app.services.pdf_parser import PDFParser

    new_total = PDFParser.extract_reward_points(text)
    source = "auto"
    if new_total is None and ai_context:
        try:
            from app.services import ai_pdf_extraction
            new_total = ai_pdf_extraction.extract_reward_points_ai(
                ai_context["db"], ai_context["user_id"], text
            )
            source = "ai"
        except Exception:
            logger.warning("AI reward-points fallback failed for bank %s", bank.id, exc_info=True)

    if new_total is None:
        return None

    current_balance = (
        db.query(RewardPointEntry)
        .filter(RewardPointEntry.bank_id == bank.id, RewardPointEntry.user_id == bank.user_id)
        .all()
    )
    delta = new_total - sum(e.points for e in current_balance)
    if abs(delta) < 0.01:
        bank.reward_points_updated_at = statement_date
        return None

    breakdown = PDFParser.extract_reward_points_breakdown(text)
    last_entry = None

    def _add(entry_type: str, points: float, description: str) -> None:
        nonlocal last_entry
        last_entry = RewardPointEntry(
            user_id=bank.user_id, bank_id=bank.id, pdf_statement_id=pdf_statement_id,
            entry_type=entry_type, points=points, entry_date=statement_date,
            source=source, description=description,
        )
        db.add(last_entry)

    accounted = 0.0
    if breakdown:
        if breakdown["earned"] > 0.01:
            _add("earned", breakdown["earned"], f"Earned this cycle (statement printed {breakdown['earned']:,.0f})")
            accounted += breakdown["earned"]
        if breakdown["redeemed"] > 0.01:
            _add("redeemed", -breakdown["redeemed"], f"Redeemed this cycle (statement printed {breakdown['redeemed']:,.0f})")
            accounted -= breakdown["redeemed"]
        if breakdown["expired"] > 0.01:
            _add("expired", -breakdown["expired"], f"Expired/lapsed this cycle (statement printed {breakdown['expired']:,.0f})")
            accounted -= breakdown["expired"]

    residual = delta - accounted
    if abs(residual) >= 0.01 or last_entry is None:
        _add(
            "adjustment", residual,
            f"Reconciled to statement's printed balance ({new_total:,.0f} pts)"
            if last_entry is None else "Reconciliation to statement's printed balance",
        )

    bank.reward_points_updated_at = statement_date
    return last_entry


def check_expiring_reward_points(db: Session, user_ids=None) -> dict:
    """Daily task: for each 'earned' entry with an unnotified expiry threshold
    now crossed, send one Discord message and record the threshold so tomorrow's
    run doesn't repeat it. Returns {notified: n}."""
    from app.services import discord_service

    now = utcnow()
    q = db.query(RewardPointEntry).filter(
        RewardPointEntry.entry_type == "earned",
        RewardPointEntry.expiry_date.isnot(None),
        RewardPointEntry.expiry_date > now,
    )
    if user_ids is not None:
        q = q.filter(RewardPointEntry.user_id.in_(user_ids))
    entries = q.all()

    notified = 0
    for entry in entries:
        days_left = (entry.expiry_date - now).days
        threshold = next((t for t in EXPIRY_WARNING_DAYS if days_left <= t), None)
        if threshold is None:
            continue
        if entry.notified_threshold is not None and entry.notified_threshold <= threshold:
            continue  # already warned at this threshold or a tighter one

        bank = db.query(Bank).filter(Bank.id == entry.bank_id).first()
        bank_name = bank.name if bank else "a card"
        try:
            sent = discord_service.send_discord_message(
                db, entry.user_id,
                f"{bank_name}: {entry.points:,.0f} reward points expiring soon",
                f"{entry.points:,.0f} points on {bank_name} expire on "
                f"{entry.expiry_date.strftime('%d %b %Y')} ({days_left} day"
                f"{'s' if days_left != 1 else ''} left)"
                + (f" — {entry.description}" if entry.description else "") + ".",
            )
        except Exception:
            logger.warning("Discord notify failed for reward entry %s", entry.id, exc_info=True)
            continue
        if not sent:
            continue  # no webhook configured for this user -- don't mark as notified
        entry.notified_threshold = threshold
        notified += 1

    if notified:
        db.commit()
        logger.info("Reward points expiry check: %d notification(s) sent", notified)
    return {"notified": notified}
