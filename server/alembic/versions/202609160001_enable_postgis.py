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
    # The postgis/postgis Docker image auto-installs postgis_topology and
    # postgis_tiger_geocoder on first start, both depending on postgis; CASCADE
    # drops those too since we don't manage them ourselves.
    op.execute("DROP EXTENSION IF EXISTS postgis CASCADE")
