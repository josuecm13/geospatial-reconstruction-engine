"""create the generation tables: runs, generated buildings, zones, fingerprints, and block feedback

Revision ID: 202610120001
Revises: 202610110002
Create Date: 2026-10-12
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "202610120001"
down_revision = "202610110002"
branch_labels = None
depends_on = None


def _uuid_pk() -> sa.Column:
    return sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    # Generation never writes to an observed table. Everything here cascades from the area or the
    # run, and generated buildings and zones also from their block, so a re-import that sweeps a
    # block removes what was generated on it (the run is then stale).
    op.create_table(
        "generation_runs",
        _uuid_pk(),
        sa.Column("import_area_id", UUID(as_uuid=True), sa.ForeignKey("import_areas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("algorithm_version", sa.String(), nullable=False),
        sa.Column("parameters", JSONB(), nullable=False),
        sa.Column("elevation_version", sa.Integer(), nullable=True),
        sa.Column("road_graph_hash", sa.String(), nullable=False),
        sa.Column("building_count", sa.Integer(), nullable=False),
        sa.Column("block_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # One current run per area: generating again replaces it.
        sa.UniqueConstraint("import_area_id", name="uq_generation_runs_import_area"),
    )

    op.create_table(
        "generated_buildings",
        _uuid_pk(),
        sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("generation_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("block_id", UUID(as_uuid=True), sa.ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="POLYGON", srid=4326, spatial_index=False), nullable=False),
        sa.Column("height_meters", sa.Float(), nullable=False),
        sa.Column("levels", sa.Integer(), nullable=False),
        sa.Column("base_elevation_meters", sa.Float(), nullable=True),
        sa.Column("style", sa.String(), nullable=False),
        # No foreign key: the reference can be a block of another area.
        sa.Column("reference_block_id", UUID(as_uuid=True), nullable=True),
        sa.Column("count_source", sa.String(), nullable=False),
        sa.CheckConstraint("count_source IN ('reference', 'default', 'feedback')", name="ck_generated_buildings_count_source"),
        sa.CheckConstraint("height_meters > 0", name="ck_generated_buildings_height_positive"),
    )
    op.create_index("ix_generated_buildings_run_id", "generated_buildings", ["run_id"])
    op.create_index("ix_generated_buildings_block_id", "generated_buildings", ["block_id"])
    op.create_index("ix_generated_buildings_geom", "generated_buildings", ["geom"], postgresql_using="gist")

    op.create_table(
        "generation_zones",
        _uuid_pk(),
        sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("generation_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("block_id", UUID(as_uuid=True), sa.ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=False), nullable=False),
    )
    op.create_index("ix_generation_zones_run_id", "generation_zones", ["run_id"])
    op.create_index("ix_generation_zones_block_id", "generation_zones", ["block_id"])
    op.create_index("ix_generation_zones_geom", "generation_zones", ["geom"], postgresql_using="gist")

    op.create_table(
        "block_fingerprints",
        sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("generation_runs.id", ondelete="CASCADE"), primary_key=True),
        # No foreign key: an exemplar may be a block of another area.
        sa.Column("block_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("fingerprint", JSONB(), nullable=False),
    )

    op.create_table(
        "block_feedback",
        # No foreign key to blocks: feedback must outlive a re-import that removes its block, so it
        # can be reported as orphaned.
        sa.Column("block_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("import_area_id", UUID(as_uuid=True), sa.ForeignKey("import_areas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("building_count", sa.Integer(), nullable=True),
        sa.Column("no_buildings", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "(building_count IS NOT NULL AND NOT no_buildings) OR (building_count IS NULL AND no_buildings)",
            name="ck_block_feedback_exactly_one",
        ),
        sa.CheckConstraint("building_count >= 0", name="ck_block_feedback_count_non_negative"),
    )
    op.create_index("ix_block_feedback_import_area_id", "block_feedback", ["import_area_id"])


def downgrade() -> None:
    op.drop_table("block_feedback")
    op.drop_table("block_fingerprints")
    op.drop_table("generation_zones")
    op.drop_table("generated_buildings")
    op.drop_table("generation_runs")
