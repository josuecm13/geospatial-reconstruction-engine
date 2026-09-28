"""create traced_boundaries with validity and containment enforcement

Revision ID: 202609280001
Revises: 202609270002
Create Date: 2026-09-28
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "202609280001"
down_revision = "202609270002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "traced_boundaries",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "import_area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("import_areas.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="POLYGON", srid=4326), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("import_area_id", "name", name="uq_traced_boundaries_import_area_name"),
        sa.CheckConstraint(
            "ST_IsValid(geom) AND ST_IsSimple(geom)", name="ck_traced_boundaries_geom_valid"
        ),
    )
    op.create_index("ix_traced_boundaries_import_area_id", "traced_boundaries", ["import_area_id"])
    op.create_index("ix_traced_boundaries_geom", "traced_boundaries", ["geom"], postgresql_using="gist")

    # Containment reads import_areas, so it can't be a CHECK. It raises check_violation so
    # both backstops surface to the application as the same integrity error.
    op.execute(
        """
        CREATE FUNCTION check_traced_boundary_containment() RETURNS trigger AS $$
        DECLARE
            area_bbox geometry;
        BEGIN
            SELECT bbox INTO area_bbox FROM import_areas WHERE id = NEW.import_area_id;

            IF NOT ST_CoveredBy(NEW.geom, area_bbox) THEN
                RAISE EXCEPTION
                    'traced_boundaries: boundary % extends outside import area %',
                    NEW.name, NEW.import_area_id
                    USING ERRCODE = 'check_violation';
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER traced_boundaries_containment_check
        BEFORE INSERT OR UPDATE ON traced_boundaries
        FOR EACH ROW EXECUTE FUNCTION check_traced_boundary_containment();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS traced_boundaries_containment_check ON traced_boundaries")
    op.execute("DROP FUNCTION IF EXISTS check_traced_boundary_containment()")
    op.drop_table("traced_boundaries")
