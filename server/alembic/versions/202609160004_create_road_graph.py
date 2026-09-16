"""create road graph tables

Revision ID: 202609160004
Revises: 202609160003
Create Date: 2026-09-16
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID

revision = "202609160004"
down_revision = "202609160003"
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
        "streets",
        _uuid_pk(),
        sa.Column(
            "import_area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("import_areas.id"),
            nullable=False,
        ),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column(
            "classification", PgEnum(name="road_classification", create_type=False), nullable=False
        ),
        *_timestamps(),
        sa.UniqueConstraint(
            "import_area_id", "source_id", name="uq_streets_import_area_source"
        ),
    )
    op.create_index("ix_streets_import_area_id", "streets", ["import_area_id"])

    op.create_table(
        "roads",
        _uuid_pk(),
        sa.Column(
            "import_area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("import_areas.id"),
            nullable=False,
        ),
        sa.Column("street_id", UUID(as_uuid=True), sa.ForeignKey("streets.id"), nullable=True),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column(
            "classification", PgEnum(name="road_classification", create_type=False), nullable=False
        ),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="LINESTRING", srid=4326), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("import_area_id", "source_id", name="uq_roads_import_area_source"),
    )
    op.create_index("ix_roads_import_area_id", "roads", ["import_area_id"])
    op.create_index("ix_roads_street_id", "roads", ["street_id"])
    op.create_index("ix_roads_geom", "roads", ["geom"], postgresql_using="gist")

    op.create_table(
        "navigable_nodes",
        _uuid_pk(),
        sa.Column(
            "import_area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("import_areas.id"),
            nullable=False,
        ),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="POINT", srid=4326), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint(
            "import_area_id", "source_id", name="uq_navigable_nodes_import_area_source"
        ),
    )
    op.create_index("ix_navigable_nodes_import_area_id", "navigable_nodes", ["import_area_id"])
    op.create_index("ix_navigable_nodes_geom", "navigable_nodes", ["geom"], postgresql_using="gist")

    op.create_table(
        "road_segments",
        _uuid_pk(),
        sa.Column("road_id", UUID(as_uuid=True), sa.ForeignKey("roads.id"), nullable=False),
        sa.Column(
            "from_node_id", UUID(as_uuid=True), sa.ForeignKey("navigable_nodes.id"), nullable=False
        ),
        sa.Column(
            "to_node_id", UUID(as_uuid=True), sa.ForeignKey("navigable_nodes.id"), nullable=False
        ),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="LINESTRING", srid=4326), nullable=False),
        sa.Column("distance_meters", sa.Float(), nullable=False),
        sa.Column("lane_count", sa.SmallInteger(), nullable=True),
        sa.Column(
            "is_vehicle_accessible", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        *_timestamps(),
        sa.UniqueConstraint(
            "road_id", "from_node_id", "to_node_id", name="uq_road_segments_road_from_to"
        ),
    )
    op.create_index("ix_road_segments_road_id", "road_segments", ["road_id"])
    op.create_index("ix_road_segments_from_node_id", "road_segments", ["from_node_id"])
    op.create_index("ix_road_segments_to_node_id", "road_segments", ["to_node_id"])
    op.create_index("ix_road_segments_geom", "road_segments", ["geom"], postgresql_using="gist")


def downgrade() -> None:
    op.drop_table("road_segments")
    op.drop_table("navigable_nodes")
    op.drop_table("roads")
    op.drop_table("streets")
