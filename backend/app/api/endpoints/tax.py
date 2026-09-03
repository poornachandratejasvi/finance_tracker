"""Tax-saving dashboard -- 80C/80D/80CCD(1B) utilization + HRA exemption, all
computed from data already tracked elsewhere. See tax_service.py."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User
from app.services import tax_service

router = APIRouter()


@router.get("/dashboard")
def get_tax_dashboard(
    financial_year: Optional[str] = Query(None, description="e.g. '2026-27' -- defaults to the current FY"),
    senior_citizen: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return tax_service.dashboard(db, current_user.id, financial_year, senior_citizen)
