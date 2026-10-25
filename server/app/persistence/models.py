from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
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
    place_name = Column(String, nullable=True)
    place_context = Column(String, nullable=True)
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
    # True when part of the boundary is the import area's bounding box, not a road.
    is_clipped = Column(Boolean, nullable=False, server_default="false")
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
    height_meters = Column(Float, nullable=True)
    levels = Column(Integer, nullable=True)
    building_type = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("import_area_id", "source_id", name="uq_buildings_import_area_source"),
        CheckConstraint("height_meters > 0", name="ck_buildings_height_positive"),
        CheckConstraint("levels >= 0", name="ck_buildings_levels_non_negative"),
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


class TracedBoundaryModel(Base):
    __tablename__ = "traced_boundaries"

    id = uuid_pk()
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id"), nullable=False, index=True
    )
    name = Column(String, nullable=False)
    # Valid, simple, and covered by the import area's bbox: a CHECK constraint and a
    # trigger enforce it in the database (migration 202609280001).
    geom = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("import_area_id", "name", name="uq_traced_boundaries_import_area_name"),
    )


class SiteSettingModel(Base):
    """A deployment-wide setting, e.g. the import area the landing page features."""

    __tablename__ = "site_settings"

    key = Column(String, primary_key=True)
    value = Column(JSONB, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AreaElevationGridModel(Base):
    """An area's ground, one row per area. Elevation lives apart from the observed tables."""

    __tablename__ = "area_elevation_grids"

    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id", ondelete="CASCADE"), primary_key=True
    )
    origin_latitude = Column(Float, nullable=False)
    origin_longitude = Column(Float, nullable=False)
    lat_step = Column(Float, nullable=False)
    lon_step = Column(Float, nullable=False)
    rows = Column(Integer, nullable=False)
    cols = Column(Integer, nullable=False)
    # rows * cols little-endian float32, row-major from the south-west corner.
    heights = Column(LargeBinary, nullable=False)
    source = Column(String, nullable=False)
    algorithm = Column(String, nullable=False)
    version = Column(Integer, nullable=False)
    smoothing_meters = Column(Float, nullable=False)
    analysed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("rows >= 2 AND cols >= 2", name="ck_area_elevation_grids_size"),
        CheckConstraint("octet_length(heights) = rows * cols * 4", name="ck_area_elevation_grids_heights_length"),
    )


class BuildingElevationModel(Base):
    __tablename__ = "building_elevations"

    building_id = Column(UUID(as_uuid=True), ForeignKey("buildings.id", ondelete="CASCADE"), primary_key=True)
    base_elevation_meters = Column(Float, nullable=False)


class RoadSegmentElevationModel(Base):
    __tablename__ = "road_segment_elevations"

    road_segment_id = Column(
        UUID(as_uuid=True), ForeignKey("road_segments.id", ondelete="CASCADE"), primary_key=True
    )
    # One value per vertex of the segment's geometry, in order.
    exact_meters = Column(ARRAY(Float), nullable=False)
    smoothed_meters = Column(ARRAY(Float), nullable=False)


class GenerationRunModel(Base):
    """The current generation run of an area: one per area, replaced when the area is generated again."""

    __tablename__ = "generation_runs"

    id = uuid_pk()
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    seed = Column(BigInteger, nullable=False)
    algorithm_version = Column(String, nullable=False)
    parameters = Column(JSONB, nullable=False)
    elevation_version = Column(Integer, nullable=True)
    road_graph_hash = Column(String, nullable=False)
    building_count = Column(Integer, nullable=False)
    block_count = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class GeneratedBuildingModel(Base):
    __tablename__ = "generated_buildings"

    id = uuid_pk()
    run_id = Column(UUID(as_uuid=True), ForeignKey("generation_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    # A re-import that sweeps a block takes its generated buildings with it, and the run goes stale.
    block_id = Column(UUID(as_uuid=True), ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False, index=True)
    geom = Column(Geometry(geometry_type="POLYGON", srid=4326, spatial_index=False), nullable=False)
    height_meters = Column(Float, nullable=False)
    levels = Column(Integer, nullable=False)
    base_elevation_meters = Column(Float, nullable=True)
    style = Column(String, nullable=False)
    # No foreign key: the reference can be a block of another area.
    reference_block_id = Column(UUID(as_uuid=True), nullable=True)
    count_source = Column(String, nullable=False)

    __table_args__ = (
        CheckConstraint("count_source IN ('reference', 'default', 'feedback')", name="ck_generated_buildings_count_source"),
        CheckConstraint("height_meters > 0", name="ck_generated_buildings_height_positive"),
    )


class GenerationZoneModel(Base):
    __tablename__ = "generation_zones"

    id = uuid_pk()
    run_id = Column(UUID(as_uuid=True), ForeignKey("generation_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    block_id = Column(UUID(as_uuid=True), ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False, index=True)
    reason = Column(String, nullable=False)
    geom = Column(Geometry(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=False), nullable=False)


class BlockFingerprintModel(Base):
    """The fingerprint a run used for an exemplar block, so the run is reproducible."""

    __tablename__ = "block_fingerprints"

    run_id = Column(UUID(as_uuid=True), ForeignKey("generation_runs.id", ondelete="CASCADE"), primary_key=True)
    # No foreign key: an exemplar may belong to another area.
    block_id = Column(UUID(as_uuid=True), primary_key=True)
    fingerprint = Column(JSONB, nullable=False)


class BlockFeedbackModel(Base):
    """What a person says a block really holds. There is no foreign key to `blocks`: feedback has to
    outlive a re-import that removes its block, so it can be reported as orphaned."""

    __tablename__ = "block_feedback"

    block_id = Column(UUID(as_uuid=True), primary_key=True)
    import_area_id = Column(
        UUID(as_uuid=True), ForeignKey("import_areas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    building_count = Column(Integer, nullable=True)
    no_buildings = Column(Boolean, nullable=False, server_default="false")
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "(building_count IS NOT NULL AND NOT no_buildings) OR (building_count IS NULL AND no_buildings)",
            name="ck_block_feedback_exactly_one",
        ),
        CheckConstraint("building_count >= 0", name="ck_block_feedback_count_non_negative"),
    )
