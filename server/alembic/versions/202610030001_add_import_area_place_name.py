"""add a reverse-geocoded place name to import areas

Revision ID: 202610030001
Revises: 202609300001
Create Date: 2026-10-03
"""

import sqlalchemy as sa
from alembic import op

revision = "202610030001"
down_revision = "202609300001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable: existing areas stay unnamed until the backfill script (or a re-import) names them.
    op.add_column("import_areas", sa.Column("place_name", sa.String(), nullable=True))
    op.add_column("import_areas", sa.Column("place_context", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("import_areas", "place_context")
    op.drop_column("import_areas", "place_name")
