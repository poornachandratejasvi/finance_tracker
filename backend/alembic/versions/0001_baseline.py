"""baseline schema

Creates the full schema from the SQLAlchemy models. Using metadata as the source of
truth guarantees this baseline never drifts from the models. Subsequent, incremental
migrations should be produced with ``alembic revision --autogenerate``.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-21
"""
from alembic import op

from app.core.database import Base
# Import models so every table is registered on Base.metadata.
from app.models import models  # noqa: F401

# revision identifiers, used by Alembic.
revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade():
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
