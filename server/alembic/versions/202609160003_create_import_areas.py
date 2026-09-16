"""create import_areas

Revision ID: 202609160003
Revises: 202609160002
Create Date: 2026-09-16
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID

revision = "202609160003"
down_revision = "202609160002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "import_areas",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("min_longitude", sa.Float(), nullable=False),
        sa.Column("min_latitude", sa.Float(), nullable=False),
        sa.Column("max_longitude", sa.Float(), nullable=False),
        sa.Column("max_latitude", sa.Float(), nullable=False),
        sa.Column(
            "bbox", geoalchemy2.Geometry(geometry_type="POLYGON", srid=4326), nullable=False
        ),
        sa.Column(
            "status",
            PgEnum(name="import_status", create_type=False),
            nullable=False,
        ),
        sa.Column("road_count", sa.SmallInteger(), nullable=True),
        sa.Column("node_count", sa.SmallInteger(), nullable=True),
        sa.Column("building_count", sa.SmallInteger(), nullable=True),
        sa.Column("poi_count", sa.SmallInteger(), nullable=True),
        sa.Column("area_feature_count", sa.SmallInteger(), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "provider",
            "min_longitude",
            "min_latitude",
            "max_longitude",
            "max_latitude",
            name="uq_import_areas_provider_bounds",
        ),
    )
    op.create_index(
        "ix_import_areas_bbox", "import_areas", ["bbox"], postgresql_using="gist"
    )


def downgrade() -> None:
    op.drop_index("ix_import_areas_bbox", table_name="import_areas")
    op.drop_table("import_areas")
