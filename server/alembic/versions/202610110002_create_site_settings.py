"""create site_settings: small key/value settings for the whole deployment

Revision ID: 202610110002
Revises: 202610100002
Create Date: 2026-10-11
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "202610110002"
down_revision = "202610100002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No foreign key to import_areas: the value is JSON. Deleting a featured area clears its key in
    # ImportAreaRepository.delete.
    op.create_table(
        "site_settings",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("value", JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("site_settings")
