"""enable postgis extension

Revision ID: 202609160001
Revises:
Create Date: 2026-09-16
"""

from alembic import op

revision = "202609160001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS postgis")
