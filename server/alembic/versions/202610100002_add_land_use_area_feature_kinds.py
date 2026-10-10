"""add the land-use values to the area_feature_kind enum

Revision ID: 202610100002
Revises: 202610100001
Create Date: 2026-10-10
"""

from alembic import op

revision = "202610100002"
down_revision = "202610100001"
branch_labels = None
depends_on = None

NEW_KINDS = ["forest", "farmland", "cemetery", "railway", "industrial"]


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE could not run inside a transaction block before Postgres 12, and a
    # value added in a transaction can't be used until it commits. An autocommit block runs each
    # statement outside the migration's transaction, which is safe on every version.
    with op.get_context().autocommit_block():
        for kind in NEW_KINDS:
            op.execute(f"ALTER TYPE area_feature_kind ADD VALUE IF NOT EXISTS '{kind}'")


def downgrade() -> None:
    # Postgres can't drop a value from an enum. The extra values are harmless once nothing writes
    # them, so downgrading leaves them in place.
    pass
