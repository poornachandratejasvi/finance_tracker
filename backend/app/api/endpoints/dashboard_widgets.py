"""User-configurable dashboard widgets -- lets a user add/remove/reorder/resize
widget cards on their Dashboard. Deliberately stores only the widget layout,
never data: each widget_type is rendered client-side by calling an existing
endpoint (dashboard/summary, analytics/cashflow, investments/dashboard, reward
points, recent transactions), so this never duplicates an aggregation query
that already exists elsewhere.
"""
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, DashboardWidget
from app.services.custom_widget_service import compute_custom_formula

router = APIRouter()

# The catalog of widget types a client is allowed to add -- kept here (not just
# in the frontend) so a stale/hand-crafted request can't sneak in an unknown
# type. Frontend still owns the human-facing label/icon/description per type.
WIDGET_TYPES = (
    "net_worth", "income_expense", "spending_by_category", "cashflow_trend",
    "balance_trend", "bank_balances", "investments_summary",
    "reward_points_summary", "recent_transactions", "budget_progress",
    # Added later: all reuse existing endpoints (analytics/heatmap,
    # analytics/top-merchants, watchers/detect-recurring, ai/anomalies,
    # ai/predictions) -- no new aggregation logic, same as every widget above.
    "spending_heatmap", "top_merchants", "recurring_subscriptions",
    "spending_anomalies", "cashflow_forecast", "zero_spend_streak",
    # A user-defined metric over their own accounts (see custom_widget_service) --
    # the one widget type whose data isn't just a read of an existing endpoint,
    # and the only one a user can add more than once (each instance has its own
    # config: which accounts + which operation).
    "custom_formula",
)


class WidgetCreate(BaseModel):
    widget_type: str
    size: Optional[str] = "medium"
    config: Optional[dict] = None


class WidgetUpdate(BaseModel):
    size: Optional[str] = None
    config: Optional[dict] = None


class ReorderRequest(BaseModel):
    ids: List[int]


def _to_dict(w: DashboardWidget) -> dict:
    try:
        config = json.loads(w.config) if w.config else None
    except (ValueError, TypeError):
        config = None
    return {
        "id": w.id,
        "widget_type": w.widget_type,
        "position": w.position,
        "size": w.size,
        "config": config,
    }


@router.get("/")
def list_widgets(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """List the current user's dashboard widgets, in display order."""
    widgets = (
        db.query(DashboardWidget)
        .filter(DashboardWidget.user_id == current_user.id)
        .order_by(DashboardWidget.position.asc())
        .all()
    )
    return [_to_dict(w) for w in widgets]


@router.get("/types")
def list_widget_types():
    """The set of widget types a client may add -- source of truth for validation."""
    return {"types": list(WIDGET_TYPES)}


@router.post("/", status_code=status.HTTP_201_CREATED)
def add_widget(
    payload: WidgetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    if payload.widget_type not in WIDGET_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown widget_type '{payload.widget_type}'")
    # max(position)+1, not count() -- a prior delete can leave gaps (e.g.
    # [0,1,3] after removing position 2), and count() would collide with an
    # existing position instead of appending at the true end.
    max_pos = (
        db.query(func.max(DashboardWidget.position))
        .filter(DashboardWidget.user_id == current_user.id)
        .scalar()
    )
    next_pos = (max_pos + 1) if max_pos is not None else 0
    widget = DashboardWidget(
        user_id=current_user.id,
        widget_type=payload.widget_type,
        position=next_pos,
        size=payload.size or "medium",
        config=json.dumps(payload.config) if payload.config else None,
    )
    db.add(widget)
    db.commit()
    db.refresh(widget)
    return _to_dict(widget)


@router.get("/{widget_id}/formula-value")
def get_formula_value(
    widget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Compute a custom_formula widget's current value from its stored config
    (which accounts + which operation) -- see custom_widget_service."""
    widget = db.query(DashboardWidget).filter(
        DashboardWidget.id == widget_id, DashboardWidget.user_id == current_user.id
    ).first()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")
    if widget.widget_type != "custom_formula":
        raise HTTPException(status_code=422, detail="Not a custom_formula widget")
    try:
        config = json.loads(widget.config) if widget.config else {}
    except (ValueError, TypeError):
        config = {}
    return compute_custom_formula(db, current_user, config)


@router.put("/{widget_id}")
def update_widget(
    widget_id: int,
    payload: WidgetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    widget = db.query(DashboardWidget).filter(
        DashboardWidget.id == widget_id, DashboardWidget.user_id == current_user.id
    ).first()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")
    if payload.size is not None:
        widget.size = payload.size
    if payload.config is not None:
        widget.config = json.dumps(payload.config)
    db.commit()
    db.refresh(widget)
    return _to_dict(widget)


@router.post("/reorder")
def reorder_widgets(
    payload: ReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    """Bulk reorder -- avoids N individual PUT calls for a drag-reorder UI."""
    widgets = {
        w.id: w for w in db.query(DashboardWidget).filter(
            DashboardWidget.user_id == current_user.id, DashboardWidget.id.in_(payload.ids)
        ).all()
    }
    for position, widget_id in enumerate(payload.ids):
        if widget_id in widgets:
            widgets[widget_id].position = position
    db.commit()
    return {"success": True}


@router.delete("/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_widget(
    widget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    widget = db.query(DashboardWidget).filter(
        DashboardWidget.id == widget_id, DashboardWidget.user_id == current_user.id
    ).first()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")
    db.delete(widget)
    db.commit()
