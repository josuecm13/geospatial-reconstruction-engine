"""create blocks and block_boundary_segments

Revision ID: 202609160006
Revises: 202609160005
Create Date: 2026-09-16
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "202609160006"
down_revision = "202609160005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "blocks",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "import_area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("import_areas.id"),
            nullable=False,
        ),
        sa.Column(
            "boundary", geoalchemy2.Geometry(geometry_type="POLYGON", srid=4326), nullable=False
        ),
        sa.Column("area_square_meters", sa.Float(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_blocks_import_area_id", "blocks", ["import_area_id"])
    op.create_index("ix_blocks_boundary", "blocks", ["boundary"], postgresql_using="gist")

    op.create_table(
        "block_boundary_segments",
        sa.Column("block_id", UUID(as_uuid=True), sa.ForeignKey("blocks.id"), primary_key=True),
        sa.Column(
            "road_segment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("road_segments.id"),
            primary_key=True,
        ),
        sa.Column("sequence_order", sa.SmallInteger(), nullable=False),
    )
    op.create_index(
        "ix_block_boundary_segments_road_segment_id",
        "block_boundary_segments",
        ["road_segment_id"],
    )


def downgrade() -> None:
    op.drop_table("block_boundary_segments")
    op.drop_table("blocks")
