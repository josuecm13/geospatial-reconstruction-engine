"""Pydantic request/response models (design.md Decision 6).

Pydantic validates shape and types only; range/area rules stay in the domain
`BoundingBox`/`Coordinate`, so the 1 km² rule and coordinate ranges have
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

from pydantic import BaseModel, Field


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
    payload: dict[str, Any]


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
    imported_at: datetime | None


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


class ProjectionOut(BaseModel):
    """A local projection a Cartesian renderer can place the export with, in meters:
    x = (lon - origin.lon) * meters_per_degree_longitude, y = (lat - origin.lat) * meters_per_degree_latitude."""

    origin: CoordinateIn
    meters_per_degree_latitude: float
    meters_per_degree_longitude: float


OSM_ATTRIBUTION = "© OpenStreetMap contributors"


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
