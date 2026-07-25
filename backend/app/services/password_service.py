import json
from typing import List, Optional, Tuple
from sqlalchemy.orm import Session

from app.models.models import Bank, BankConfig
from app.services.pdf_parser import PDFParser


def _unique_passwords(passwords: List[str]) -> List[str]:
    seen = set()
    unique = []
    for pwd in passwords:
        cleaned = (pwd or "").strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        unique.append(cleaned)
    return unique


def get_password_candidates(db: Session, bank: Bank) -> List[str]:
    """Return ordered unique password candidates for a bank."""
    candidates: List[str] = []

    if bank.account_password:
        candidates.append(bank.account_password)

    config = db.query(BankConfig).filter(BankConfig.bank_id == bank.id).order_by(BankConfig.id.desc()).first()
    if config and config.password_hints:
        try:
            data = json.loads(config.password_hints)
            if isinstance(data, dict) and isinstance(data.get("candidates"), list):
                candidates.extend(data["candidates"])
            elif isinstance(data, list):
                candidates.extend(data)
        except Exception:
            pass

    return _unique_passwords(candidates)


def save_password_candidates(db: Session, bank: Bank, candidates: List[str]) -> List[str]:
    """Persist password candidates in BankConfig.password_hints and return saved list."""
    normalized = _unique_passwords(candidates)

    config = db.query(BankConfig).filter(BankConfig.bank_id == bank.id).order_by(BankConfig.id.desc()).first()
    if not config:
        config = BankConfig(bank_id=bank.id, email_pattern="*", subject_pattern="")
        db.add(config)

    config.password_hints = json.dumps({"candidates": normalized})
    db.commit()
    db.refresh(config)

    return normalized


def parse_with_passwords(
    pdf_path: str,
    bank_code: Optional[str],
    passwords: List[str],
    field_mapping: Optional[dict] = None
) -> Tuple[dict, Optional[str]]:
    """Try parsing with multiple passwords and return the first success."""
    if not passwords:
        passwords = [None]

    last_result = None
    for pwd in passwords:
        result = PDFParser.parse_statement(
            pdf_path=pdf_path,
            bank_code=bank_code,
            password=pwd,
            field_mapping=field_mapping
        )
        last_result = result
        if result.get("success"):
            return result, pwd

    if last_result is None:
        last_result = {"success": False, "error": "Could not extract text from PDF"}
    return last_result, None
