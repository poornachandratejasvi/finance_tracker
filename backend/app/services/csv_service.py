import os
from datetime import datetime
from email.message import EmailMessage
from typing import Dict, Optional, Tuple
import smtplib

import pandas as pd

from app.core.config import settings
from app.core.time_utils import utcnow
from app.services.pdf_parser import PDFParser
from app.services.password_service import get_password_candidates, parse_with_passwords
from app.services.pdf_storage import ensure_decrypted_with_candidates, get_preferred_pdf_path


def _csv_dir() -> str:
    csv_dir = os.path.join(settings.UPLOAD_DIR, settings.CSV_SUBDIR)
    os.makedirs(csv_dir, exist_ok=True)
    return csv_dir


def _build_csv_path(pdf_statement) -> str:
    base_name = os.path.splitext(os.path.basename(pdf_statement.file_name))[0]
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in base_name).strip("_")
    filename = f"{pdf_statement.id}_{safe_name}.csv"
    return os.path.join(_csv_dir(), filename)


def _normalize_tables(tables: list[pd.DataFrame]) -> pd.DataFrame:
    cleaned = []
    for table in tables:
        if table is None or table.empty:
            continue
        table = table.copy()
        table.columns = [str(col).strip() for col in table.columns]
        table = table.dropna(axis=1, how='all')
        cleaned.append(table)

    if not cleaned:
        return pd.DataFrame()

    return pd.concat(cleaned, ignore_index=True, sort=False)


CSV_COLUMNS = ["Transaction Date", "Description", "Amount", "Type", "Balance", "Reference", "Category"]


def _transactions_to_dataframe(transactions: list[Dict]) -> pd.DataFrame:
    rows = []
    for trans in transactions:
        rows.append({
            "Transaction Date": trans.get("transaction_date"),
            "Description": trans.get("description"),
            "Amount": trans.get("amount"),
            "Type": trans.get("transaction_type"),
            "Balance": trans.get("balance"),
            "Reference": trans.get("reference_number"),
            "Category": trans.get("category"),
        })
    return pd.DataFrame(rows, columns=CSV_COLUMNS)


def _db_transactions_to_dataframe(txns) -> pd.DataFrame:
    """Build the structured CSV from already-parsed DB transactions (what the app shows)."""
    rows = []
    for t in txns:
        ttype = getattr(t.transaction_type, "value", t.transaction_type)
        rows.append({
            "Transaction Date": t.transaction_date.isoformat() if t.transaction_date else None,
            "Description": t.description,
            "Amount": t.amount,
            "Type": ttype,
            "Balance": t.balance,
            "Reference": t.reference_number,
            "Category": t.category,
        })
    return pd.DataFrame(rows, columns=CSV_COLUMNS)


def generate_csv_for_pdf(db, pdf_statement, bank) -> Dict:
    """Generate a CSV for a PDF statement using the app's STRUCTURED transaction columns
    (Transaction Date, Description, Amount, Type, Balance, Reference, Category) — not the
    raw, bank-specific PDF table columns."""
    from app.models.models import Transaction

    csv_path = _build_csv_path(pdf_statement)
    import json
    field_mapping = json.loads(bank.field_mapping) if bank.field_mapping else None

    # Prefer the already-parsed transactions stored for this statement — they match
    # exactly what the app displays and need no re-parsing.
    db_txns = (
        db.query(Transaction)
        .filter(Transaction.pdf_statement_id == pdf_statement.id)
        .order_by(Transaction.transaction_date)
        .all()
    )
    if db_txns:
        df = _db_transactions_to_dataframe(db_txns)
    else:
        # Not yet processed into transactions — parse now into the SAME structured shape.
        if pdf_statement.is_password_protected:
            candidates = get_password_candidates(db, bank)
            parse_result, used_password = parse_with_passwords(
                pdf_path=pdf_statement.file_path,
                bank_code=bank.code,
                passwords=candidates,
                field_mapping=field_mapping
            )
            if used_password and used_password != bank.account_password:
                bank.account_password = used_password
                db.commit()
        else:
            parse_result = PDFParser.parse_statement(
                pdf_path=pdf_statement.file_path,
                bank_code=bank.code,
                password=None,
                field_mapping=field_mapping
            )
        if not parse_result.get("success"):
            raise ValueError(parse_result.get("error", "Failed to parse PDF"))
        df = _transactions_to_dataframe(parse_result.get("transactions", []))

    df.to_csv(csv_path, index=False)

    return {
        "csv_path": csv_path,
        "row_count": len(df),
        "generated_at": utcnow(),
    }


def send_csv_email(to_email: str, subject: str, body: str, attachment_path: str) -> None:
    if not settings.SMTP_HOST:
        raise ValueError("SMTP_HOST is not configured")

    sender = settings.SMTP_FROM or settings.SMTP_USER
    if not sender:
        raise ValueError("SMTP_FROM or SMTP_USER must be configured")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(body)

    with open(attachment_path, "rb") as f:
        data = f.read()

    filename = os.path.basename(attachment_path)
    msg.add_attachment(data, maintype="text", subtype="csv", filename=filename)

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        if settings.SMTP_USE_TLS:
            server.starttls()
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.send_message(msg)
