"""create buildings, points_of_interest, area_features

Revision ID: 202609160007
Revises: 202609160006
Create Date: 2026-09-16
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID

revision = "202609160007"
down_revision = "202609160006"
branch_labels = None
depends_on = None


def _uuid_pk() -> sa.Column:
    return sa.Column(
        "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
    )


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "buildings",
        _uuid_pk(),
        sa.Column(
            "import_area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("import_areas.id"),
            nullable=False,
        ),
        sa.Column("block_id", UUID(as_uuid=True), sa.ForeignKey("blocks.id"), nullable=True),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column(
            "category", PgEnum(name="building_category", create_type=False), nullable=False
        ),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="POLYGON", srid=4326), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint(
            "import_area_id", "source_id", name="uq_buildings_import_area_source"
        ),
    )
    op.create_index("ix_buildings_import_area_id", "buildings", ["import_area_id"])
    op.create_index("ix_buildings_block_id", "buildings", ["block_id"])
    op.create_index("ix_buildings_geom", "buildings", ["geom"], postgresql_using="gist")

    op.create_table(
        "points_of_interest",
        _uuid_pk(),
        sa.Column(
            "import_area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("import_areas.id"),
            nullable=False,
        ),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column("category", PgEnum(name="poi_category", create_type=False), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="POINT", srid=4326), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint(
            "import_area_id", "source_id", name="uq_points_of_interest_import_area_source"
        ),
    )
    op.create_index(
        "ix_points_of_interest_import_area_id", "points_of_interest", ["import_area_id"]
    )
    op.create_index(
        "ix_points_of_interest_geom", "points_of_interest", ["geom"], postgresql_using="gist"
    )

    op.create_table(
        "area_features",
        _uuid_pk(),
        sa.Column(
            "import_area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("import_areas.id"),
            nullable=False,
        ),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column(
            "kind", PgEnum(name="area_feature_kind", create_type=False), nullable=False
        ),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="POLYGON", srid=4326), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint(
            "import_area_id", "source_id", name="uq_area_features_import_area_source"
        ),
    )
    op.create_index("ix_area_features_import_area_id", "area_features", ["import_area_id"])
    op.create_index("ix_area_features_geom", "area_features", ["geom"], postgresql_using="gist")


def downgrade() -> None:
    op.drop_table("area_features")
    op.drop_table("points_of_interest")
    op.drop_table("buildings")
