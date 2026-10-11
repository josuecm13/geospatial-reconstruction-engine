"""Pydantic request/response models (design.md Decision 6).

Pydantic validates shape and types only; range/area rules stay in the domain
`BoundingBox`/`Coordinate`, so the 10 km² rule and coordinate ranges have
exactly one implementation each, surfacing as `invalid_bounding_box` /
`invalid_coordinate` rather than the generic `invalid_request`.

Geometry is plain GeoJSON (`dict`), not a typed union of Point/LineString/
Polygon models: every layer already goes through the same generic
`Feature`/`FeatureCollection` wrapper, so a stricter geometry type would only
duplicate what `app/api/mappers.py` already guarantees by construction.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CoordinateIn(BaseModel):
    latitude: float
    longitude: float


class BoundingBoxIn(BaseModel):
    min_latitude: float
    min_longitude: float
    max_latitude: float
    max_longitude: float


class EntityKind(str, Enum):
    NODE = "node"
    POI = "poi"
    BUILDING = "building"
    AREA_FEATURE = "area_feature"


class BboxEntityKind(str, Enum):
    NODE = "node"
    BUILDING = "building"
    AREA_FEATURE = "area_feature"


class BboxMode(str, Enum):
    INTERSECTS = "intersects"
    CONTAINS = "contains"


class NearestKind(str, Enum):
    NODE = "node"
    SEGMENT = "segment"


class Feature(BaseModel):
    type: str = "Feature"
    id: uuid.UUID
    geometry: dict[str, Any]
    properties: dict[str, Any]


class FeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: list[Feature]


class ImportAreaCreate(BaseModel):
    bbox: BoundingBoxIn
    # Omitted: the box is fetched live from Overpass.
    payload: dict[str, Any] | None = None
    # True: answer 202 at once and stream the import's stages from `events_url`.
    background: bool = False


class ImportStartedOut(BaseModel):
    import_area_id: uuid.UUID
    events_url: str


class ImportAreaListOut(BaseModel):
    import_areas: list["ImportAreaOut"]


class ImportAreaOut(BaseModel):
    id: uuid.UUID
    provider: str
    bbox: BoundingBoxIn
    status: str
    road_count: int | None
    node_count: int | None
    building_count: int | None
    poi_count: int | None
    area_feature_count: int | None
    block_count: int
    linked_building_count: int | None = None
    # Only on an import's own response: restriction relations skipped as malformed or
    # unresolvable inside the import.
    skipped_restriction_count: int | None = None
    # Likewise: building and area ways skipped for not being a closed ring.
    skipped_feature_count: int | None = None
    imported_at: datetime | None
    # Where the area is, from a reverse geocoder; null when unknown or the lookup failed.
    place_name: str | None = None
    place_context: str | None = None


class ExportMode(str, Enum):
    """`filter` returns whole entities and stays routable; `clip` cuts geometry at the
    scope for rendering, so a clipped segment no longer ends at a node."""

    FILTER = "filter"
    CLIP = "clip"


class ScopeType(str, Enum):
    IMPORT_AREA = "import_area"
    BOUNDARY = "boundary"


class ScopeOut(BaseModel):
    type: ScopeType
    id: uuid.UUID
    # The completed areas inside the import area's rectangle whose features the response composes.
    composed_area_ids: list[uuid.UUID] = []


class ProjectionOut(BaseModel):
    """A local projection a Cartesian renderer can place the export with, in meters:
    x = (lon - origin.lon) * meters_per_degree_longitude, y = (lat - origin.lat) * meters_per_degree_latitude."""

    origin: CoordinateIn
    meters_per_degree_latitude: float
    meters_per_degree_longitude: float


OSM_ATTRIBUTION = "© OpenStreetMap contributors"


class ElevationGridOut(BaseModel):
    """The area's ground: `heights` is rows x cols metres above sea level, row-major from the
    south edge, west to east, starting at the south-west `origin`."""

    origin: CoordinateIn
    lat_step: float
    lon_step: float
    rows: int
    cols: int
    heights: list[float]


class ElevationOut(BaseModel):
    source: str
    attribution: str
    version: int
    smoothing_meters: float
    grid: ElevationGridOut


class GenerationRunOut(BaseModel):
    """The area's current generation run. `stale` is computed when it is read: a re-import changed
    the blocks (`roads_changed`) or the ground changed (`terrain_changed`)."""

    run_id: uuid.UUID
    seed: int
    algorithm_version: str
    created_at: datetime
    building_count: int
    # Blocks the run generated at least one building on.
    block_count: int
    eligible_block_count: int
    stale: bool
    stale_reasons: list[str]
    # Blocks whose feedback asked for more buildings than fit.
    feedback_shortfall_block_ids: list[uuid.UUID]
    calibration_ratio: float | None


class GenerationRequest(BaseModel):
    """Optional body of `POST /import-areas/{id}/generation`."""

    model_config = ConfigDict(extra="forbid")

    seed: int | None = None


class BlockFeedbackIn(BaseModel):
    """Exactly one of `building_count` (0 or more) or `no_buildings: true`."""

    model_config = ConfigDict(extra="forbid")

    building_count: int | None = Field(default=None, ge=0)
    no_buildings: bool | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "BlockFeedbackIn":
        has_count = self.building_count is not None
        says_none = self.no_buildings is True
        if has_count == says_none:
            raise ValueError("set exactly one of building_count or no_buildings: true")
        return self


class BlockFeedbackOut(BaseModel):
    block_id: uuid.UUID
    import_area_id: uuid.UUID
    building_count: int | None
    no_buildings: bool
    updated_at: datetime | None


class BlockFeedbackEntryOut(BlockFeedbackOut):
    # True when the block no longer exists (a re-import swept it); the feedback is kept so it can be seen.
    orphaned: bool


class BlockFeedbackListOut(BaseModel):
    feedback: list[BlockFeedbackEntryOut]


class MapDataOut(BaseModel):
    attribution: str = OSM_ATTRIBUTION
    scope: ScopeOut
    mode: ExportMode
    projection: ProjectionOut
    road_segments: FeatureCollection
    navigable_nodes: FeatureCollection
    blocks: FeatureCollection
    buildings: FeatureCollection
    pois: FeatureCollection
    area_features: FeatureCollection
    # The area's current generation run, and what it produced (empty collections without one).
    generation: GenerationRunOut | None = None
    generated_buildings: FeatureCollection
    generation_zones: FeatureCollection
    # Null until the area has been analysed (or when the terrain source was unavailable).
    elevation: ElevationOut | None = None


class TracedBoundaryCreate(BaseModel):
    name: str
    # A GeoJSON Polygon, parsed and validated in the router so a bad shape is an
    # `invalid_boundary` with the rule that failed, not a generic `invalid_request`.
    geometry: dict[str, Any]


class NearbyOut(BaseModel):
    results: list[Feature]


class WithinBboxOut(BaseModel):
    results: list[Feature]


class NearestOut(BaseModel):
    result: Feature | None


class FootprintAreaOut(BaseModel):
    building_id: uuid.UUID
    area_square_meters: float


class RouteRequest(BaseModel):
    origin: CoordinateIn
    destination: CoordinateIn
    strategy: str | None = None


class RoutingStrategiesOut(BaseModel):
    strategies: list[str]
    default: str


class RouteOut(BaseModel):
    node_ids: list[uuid.UUID]
    segment_ids: list[uuid.UUID]
    geometry: dict[str, Any] | None
    total_distance_meters: float
    strategy: str
    origin_node_id: uuid.UUID
    destination_node_id: uuid.UUID
    origin_snap_distance_meters: float
    destination_snap_distance_meters: float
