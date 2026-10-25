"""add the raw OSM building type to buildings

Revision ID: 202610120002
Revises: 202610120001
Create Date: 2026-10-12
"""

import sqlalchemy as sa
from alembic import op

revision = "202610120002"
down_revision = "202610120001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null until a re-import fills it in; the category stays the coarse grouping.
    op.add_column("buildings", sa.Column("building_type", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("buildings", "building_type")
