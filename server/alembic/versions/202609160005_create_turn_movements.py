"""create turn_movements with segment-intersection integrity trigger

Revision ID: 202609160005
Revises: 202609160004
Create Date: 2026-09-16
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID

revision = "202609160005"
down_revision = "202609160004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "turn_movements",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "intersection_node_id",
            UUID(as_uuid=True),
            sa.ForeignKey("navigable_nodes.id"),
            nullable=False,
        ),
        sa.Column(
            "incoming_segment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("road_segments.id"),
            nullable=False,
        ),
        sa.Column(
            "outgoing_segment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("road_segments.id"),
            nullable=False,
        ),
        sa.Column("movement_kind", PgEnum(name="movement_kind", create_type=False), nullable=False),
        sa.Column("allowed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "restriction_kind",
            PgEnum(name="restriction_kind", create_type=False),
            nullable=False,
            server_default="none",
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "incoming_segment_id",
            "outgoing_segment_id",
            name="uq_turn_movements_incoming_outgoing",
        ),
    )
    op.create_index(
        "ix_turn_movements_intersection_node_id", "turn_movements", ["intersection_node_id"]
    )
    op.create_index(
        "ix_turn_movements_incoming_segment_id", "turn_movements", ["incoming_segment_id"]
    )
    op.create_index(
        "ix_turn_movements_outgoing_segment_id", "turn_movements", ["outgoing_segment_id"]
    )

    op.execute(
        """
        CREATE FUNCTION check_turn_movement_integrity() RETURNS trigger AS $$
        DECLARE
            incoming_to_node UUID;
            outgoing_from_node UUID;
        BEGIN
            SELECT to_node_id INTO incoming_to_node
            FROM road_segments WHERE id = NEW.incoming_segment_id;

            SELECT from_node_id INTO outgoing_from_node
            FROM road_segments WHERE id = NEW.outgoing_segment_id;

            IF incoming_to_node IS DISTINCT FROM NEW.intersection_node_id THEN
                RAISE EXCEPTION
                    'turn_movements: incoming_segment % does not end at intersection_node %',
                    NEW.incoming_segment_id, NEW.intersection_node_id;
            END IF;

            IF outgoing_from_node IS DISTINCT FROM NEW.intersection_node_id THEN
                RAISE EXCEPTION
                    'turn_movements: outgoing_segment % does not start at intersection_node %',
                    NEW.outgoing_segment_id, NEW.intersection_node_id;
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER turn_movements_integrity_check
        BEFORE INSERT OR UPDATE ON turn_movements
        FOR EACH ROW EXECUTE FUNCTION check_turn_movement_integrity();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS turn_movements_integrity_check ON turn_movements")
    op.execute("DROP FUNCTION IF EXISTS check_turn_movement_integrity()")
    op.drop_table("turn_movements")
