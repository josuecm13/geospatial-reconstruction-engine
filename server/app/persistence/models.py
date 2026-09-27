from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase

from app.domain.enums import (
    AreaFeatureKind,
    BuildingCategory,
    ImportStatus,
    MovementKind,
    PoiCategory,
    RestrictionKind,
    RoadClassification,
)


class Base(DeclarativeBase):
    pass


def enum_type(python_enum, name):
    return PgEnum(
        *[member.value for member in python_enum],
        name=name,
        create_type=False,
    )


def uuid_pk():
    return Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())


class ImportAreaModel(Base):
    __tablename__ = "import_areas"

    id = uuid_pk()
    provider = Column(String, nullable=False)
    min_longitude = Column(Float, nullable=False)
    min_latitude = Column(Float, nullable=False)
    max_longitude = Column(Float, nullable=False)
    max_latitude = Column(Float, nullable=False)
    bbox = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    status = Column(enum_type(ImportStatus, "import_status"), nullable=False)
    road_count = Column(SmallInteger, nullable=True)
    node_count = Column(SmallInteger, nullable=True)
    building_count = Column(SmallInteger, nullable=True)
    poi_count = Column(SmallInteger, nullable=True)
    area_feature_count = Column(SmallInteger, nullable=True)
    imported_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "provider",
            "min_longitude",
            "min_latitude",
            "max_longitude",
            "max_latitude",
            name="uq_import_areas_provider_bounds",
        ),
    )


class StreetModel(Base):
    __tablename__ = "streets"

    id = uuid_pk()
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id"), nullable=False, index=True
    )
    source_id = Column(String, nullable=False)
    name = Column(String, nullable=True)
    classification = Column(enum_type(RoadClassification, "road_classification"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("import_area_id", "source_id", name="uq_streets_import_area_source"),
    )


class RoadModel(Base):
    __tablename__ = "roads"

    id = uuid_pk()
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id"), nullable=False, index=True
    )
    street_id = Column(UUID(as_uuid=True), ForeignKey("streets.id"), nullable=True, index=True)
    source_id = Column(String, nullable=False)
    classification = Column(enum_type(RoadClassification, "road_classification"), nullable=False)
    geom = Column(Geometry(geometry_type="LINESTRING", srid=4326), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("import_area_id", "source_id", name="uq_roads_import_area_source"),
    )


class NavigableNodeModel(Base):
    __tablename__ = "navigable_nodes"

    id = uuid_pk()
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id"), nullable=False, index=True
    )
    source_id = Column(String, nullable=False)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "import_area_id", "source_id", name="uq_navigable_nodes_import_area_source"
        ),
    )


class RoadSegmentModel(Base):
    __tablename__ = "road_segments"

    id = uuid_pk()
    road_id = Column(UUID(as_uuid=True), ForeignKey("roads.id"), nullable=False, index=True)
    from_node_id = Column(
        UUID(as_uuid=True), ForeignKey("navigable_nodes.id"), nullable=False, index=True
    )
    to_node_id = Column(
        UUID(as_uuid=True), ForeignKey("navigable_nodes.id"), nullable=False, index=True
    )
    geom = Column(Geometry(geometry_type="LINESTRING", srid=4326), nullable=False)
    distance_meters = Column(Float, nullable=False)
    lane_count = Column(SmallInteger, nullable=True)
    is_vehicle_accessible = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "road_id", "from_node_id", "to_node_id", name="uq_road_segments_road_from_to"
        ),
    )


class TurnMovementModel(Base):
    __tablename__ = "turn_movements"

    id = uuid_pk()
    intersection_node_id = Column(
        UUID(as_uuid=True), ForeignKey("navigable_nodes.id"), nullable=False, index=True
    )
    incoming_segment_id = Column(
        UUID(as_uuid=True), ForeignKey("road_segments.id"), nullable=False, index=True
    )
    outgoing_segment_id = Column(
        UUID(as_uuid=True), ForeignKey("road_segments.id"), nullable=False, index=True
    )
    movement_kind = Column(enum_type(MovementKind, "movement_kind"), nullable=False)
    allowed = Column(Boolean, nullable=False, server_default="true")
    restriction_kind = Column(
        enum_type(RestrictionKind, "restriction_kind"),
        nullable=False,
        server_default=RestrictionKind.NONE.value,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "incoming_segment_id",
            "outgoing_segment_id",
            name="uq_turn_movements_incoming_outgoing",
        ),
    )


class BlockModel(Base):
    __tablename__ = "blocks"

    id = uuid_pk()
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id"), nullable=False, index=True
    )
    boundary = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    area_square_meters = Column(Float, nullable=False)
    # NULL when nothing is left once the bounding roads' half-widths are removed.
    buildable_area = Column(Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=True)
    buildable_area_square_meters = Column(Float, nullable=False, server_default="0")
    is_median = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class BlockBoundarySegmentModel(Base):
    __tablename__ = "block_boundary_segments"

    block_id = Column(UUID(as_uuid=True), ForeignKey("blocks.id"), primary_key=True)
    road_segment_id = Column(
        UUID(as_uuid=True), ForeignKey("road_segments.id"), primary_key=True, index=True
    )
    sequence_order = Column(SmallInteger, nullable=False)


class BuildingModel(Base):
    __tablename__ = "buildings"

    id = uuid_pk()
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id"), nullable=False, index=True
    )
    block_id = Column(UUID(as_uuid=True), ForeignKey("blocks.id"), nullable=True, index=True)
    source_id = Column(String, nullable=False)
    category = Column(enum_type(BuildingCategory, "building_category"), nullable=False)
    geom = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("import_area_id", "source_id", name="uq_buildings_import_area_source"),
    )


class PointOfInterestModel(Base):
    __tablename__ = "points_of_interest"

    id = uuid_pk()
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id"), nullable=False, index=True
    )
    source_id = Column(String, nullable=False)
    category = Column(enum_type(PoiCategory, "poi_category"), nullable=False)
    name = Column(String, nullable=True)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "import_area_id", "source_id", name="uq_points_of_interest_import_area_source"
        ),
    )


class AreaFeatureModel(Base):
    __tablename__ = "area_features"

    id = uuid_pk()
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id"), nullable=False, index=True
    )
    source_id = Column(String, nullable=False)
    kind = Column(enum_type(AreaFeatureKind, "area_feature_kind"), nullable=False)
    geom = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "import_area_id", "source_id", name="uq_area_features_import_area_source"
        ),
    )
