"""add source height and level count to buildings

Revision ID: 202609300001
Revises: 202609280001
Create Date: 2026-09-30
"""

import sqlalchemy as sa
from alembic import op

revision = "202609300001"
down_revision = "202609280001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable, with no server default: existing buildings stay "unknown".
    op.add_column("buildings", sa.Column("height_meters", sa.Float(), nullable=True))
    op.add_column("buildings", sa.Column("levels", sa.Integer(), nullable=True))
    op.create_check_constraint("ck_buildings_height_positive", "buildings", "height_meters > 0")
    op.create_check_constraint("ck_buildings_levels_non_negative", "buildings", "levels >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_buildings_levels_non_negative", "buildings", type_="check")
    op.drop_constraint("ck_buildings_height_positive", "buildings", type_="check")
    op.drop_column("buildings", "levels")
    op.drop_column("buildings", "height_meters")
