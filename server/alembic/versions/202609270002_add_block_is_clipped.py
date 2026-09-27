"""add clipped flag to blocks

Revision ID: 202609270002
Revises: 202609270001
Create Date: 2026-09-27
"""

import sqlalchemy as sa
from alembic import op

revision = "202609270002"
down_revision = "202609270001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("blocks", sa.Column("is_clipped", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("blocks", "is_clipped")
