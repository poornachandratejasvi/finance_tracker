"""Prometheus-format metrics endpoint for homelab dashboards. Authenticated the
same way as Shortcuts/ingest (an API token minted in Settings -> API Tokens),
since Prometheus scrape configs support a static bearer_token natively -- no new
secret storage or auth scheme needed.
"""
from fastapi import APIRouter, Depends, Response
from prometheus_client import CONTENT_TYPE_LATEST
from sqlalchemy.orm import Session

from app.core.api_auth import get_user_from_api_key
from app.core.database import get_db
from app.models.models import User
from app.services.metrics_service import render_metrics

router = APIRouter()


@router.get("")
def get_metrics(db: Session = Depends(get_db), user: User = Depends(get_user_from_api_key)):
    body = render_metrics(db, user.id)
    return Response(content=body, media_type=CONTENT_TYPE_LATEST)
