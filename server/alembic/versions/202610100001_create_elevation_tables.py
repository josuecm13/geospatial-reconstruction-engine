"""create the elevation tables: a per-area grid, and the heights derived from it

Revision ID: 202610100001
Revises: 202610030001
Create Date: 2026-10-10
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision = "202610100001"
down_revision = "202610030001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Elevation lives apart from the observed tables: none of them gains a column. The cascades
    # let deleting an area, and re-import's sweep of buildings and segments, work unchanged.
    op.create_table(
        "area_elevation_grids",
        sa.Column(
            "import_area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("import_areas.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("origin_latitude", sa.Float(), nullable=False),
        sa.Column("origin_longitude", sa.Float(), nullable=False),
        sa.Column("lat_step", sa.Float(), nullable=False),
        sa.Column("lon_step", sa.Float(), nullable=False),
        sa.Column("rows", sa.Integer(), nullable=False),
        sa.Column("cols", sa.Integer(), nullable=False),
        # rows * cols little-endian float32, row-major from the south-west corner.
        sa.Column("heights", sa.LargeBinary(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("algorithm", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("smoothing_meters", sa.Float(), nullable=False),
        sa.Column("analysed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("rows >= 2 AND cols >= 2", name="ck_area_elevation_grids_size"),
        sa.CheckConstraint("octet_length(heights) = rows * cols * 4", name="ck_area_elevation_grids_heights_length"),
    )
    op.create_table(
        "building_elevations",
        sa.Column(
            "building_id",
            UUID(as_uuid=True),
            sa.ForeignKey("buildings.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("base_elevation_meters", sa.Float(), nullable=False),
    )
    op.create_table(
        "road_segment_elevations",
        sa.Column(
            "road_segment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("road_segments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # One value per vertex of the segment's geometry, in order.
        sa.Column("exact_meters", ARRAY(sa.Float()), nullable=False),
        sa.Column("smoothed_meters", ARRAY(sa.Float()), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("road_segment_elevations")
    op.drop_table("building_elevations")
    op.drop_table("area_elevation_grids")
