"""add buildable area and median flag to blocks

Revision ID: 202609270001
Revises: 202609160007
Create Date: 2026-09-27
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op

revision = "202609270001"
down_revision = "202609160007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Blocks are derived data, re-created by every import, so existing rows
    # get neutral defaults and are corrected by the next import or re-derivation.
    op.add_column(
        "blocks",
        sa.Column("buildable_area", geoalchemy2.Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=True),
    )
    op.add_column(
        "blocks",
        sa.Column("buildable_area_square_meters", sa.Float(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column("blocks", sa.Column("is_median", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("blocks", "is_median")
    op.drop_column("blocks", "buildable_area_square_meters")
    op.drop_column("blocks", "buildable_area")
