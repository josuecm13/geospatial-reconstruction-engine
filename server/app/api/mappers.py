"""Domain -> response conversion (design.md Decision 6).

Domain objects are never returned directly from a router, which keeps
`app/domain/` free of pydantic.
"""

from __future__ import annotations

from typing import Any

from app.api.schemas import (
    BoundingBoxIn,
    Feature,
    FeatureCollection,
    ImportAreaOut,
    RouteOut,
)
from app.domain.area_feature import AreaFeature
from app.domain.block import Block
from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.building import Building
from app.domain.cross_section import SegmentCrossSection
from app.domain.geometry import LineString, Polygon
from app.domain.import_area import ImportArea
from app.domain.poi import PointOfInterest
from app.domain.road_graph import NavigableNode, RoadSegment, RoadSegmentWithStreet
from app.domain.routing import RouteResult
from app.domain.traced_boundary import TracedBoundary


def point_geometry(point: Coordinate) -> dict[str, Any]:
    return {"type": "Point", "coordinates": [point.longitude, point.latitude]}


def linestring_geometry(line: LineString) -> dict[str, Any]:
    return {"type": "LineString", "coordinates": [[p.longitude, p.latitude] for p in line]}


def polygon_geometry(ring: Polygon) -> dict[str, Any]:
    return {"type": "Polygon", "coordinates": [[[p.longitude, p.latitude] for p in ring]]}


def bbox_out(bbox: BoundingBox) -> BoundingBoxIn:
    return BoundingBoxIn(
        min_latitude=bbox.min_corner.latitude,
        min_longitude=bbox.min_corner.longitude,
        max_latitude=bbox.max_corner.latitude,
        max_longitude=bbox.max_corner.longitude,
    )


def import_area_out(area: ImportArea, block_count: int, linked_building_count: int | None = None) -> ImportAreaOut:
    return ImportAreaOut(
        id=area.id,
        provider=area.provider,
        bbox=bbox_out(area.bbox),
        status=area.status.value,
        road_count=area.road_count,
        node_count=area.node_count,
        building_count=area.building_count,
        poi_count=area.poi_count,
        area_feature_count=area.area_feature_count,
        block_count=block_count,
        linked_building_count=linked_building_count,
        imported_at=area.imported_at,
    )


def node_feature(node: NavigableNode) -> Feature:
    return Feature(id=node.id, geometry=point_geometry(node.point), properties={})


def poi_feature(poi: PointOfInterest) -> Feature:
    return Feature(id=poi.id, geometry=point_geometry(poi.point), properties={"category": poi.category.value, "name": poi.name})


def building_feature(building: Building) -> Feature:
    return Feature(
        id=building.id,
        geometry=polygon_geometry(building.geom),
        properties={"category": building.category.value, "block_id": building.block_id},
    )


def area_feature_feature(feature: AreaFeature) -> Feature:
    return Feature(id=feature.id, geometry=polygon_geometry(feature.geom), properties={"kind": feature.kind.value})


def block_feature(block: Block) -> Feature:
    return Feature(
        id=block.id,
        geometry=polygon_geometry(block.boundary),
        properties={"area_square_meters": block.area_square_meters},
    )


def segment_feature(entry: RoadSegmentWithStreet, cross_section: SegmentCrossSection) -> Feature:
    """`lane_count` is the generated count for the segment's direction; what the
    source stated (or null) stays visible as `source_lane_count`."""
    segment = entry.segment
    return Feature(
        id=segment.id,
        geometry=linestring_geometry(segment.geom),
        properties={
            "from_node_id": segment.from_node_id,
            "to_node_id": segment.to_node_id,
            "distance_meters": segment.distance_meters,
            "lane_count": cross_section.lane_count,
            "lane_count_provenance": cross_section.lane_count_provenance.value,
            "source_lane_count": segment.lane_count,
            "lane_type": cross_section.lane_type.value,
            "width_meters": cross_section.width_meters,
            "is_vehicle_accessible": segment.is_vehicle_accessible,
            "street": {"name": entry.street_name, "classification": entry.street_classification.value},
        },
    )


def segment_feature_plain(segment: RoadSegment) -> Feature:
    """For `nearest_segment`, which returns a plain `RoadSegment` with no
    street join — unlike map data's `segment_feature`, which has one."""
    return Feature(
        id=segment.id,
        geometry=linestring_geometry(segment.geom),
        properties={
            "from_node_id": segment.from_node_id,
            "to_node_id": segment.to_node_id,
            "distance_meters": segment.distance_meters,
            "lane_count": segment.lane_count,
            "is_vehicle_accessible": segment.is_vehicle_accessible,
        },
    )


def boundary_feature(boundary: TracedBoundary) -> Feature:
    return Feature(
        id=boundary.id,
        geometry=polygon_geometry(boundary.polygon),
        properties={
            "name": boundary.name,
            "import_area_id": boundary.import_area_id,
            "created_at": boundary.created_at,
        },
    )


def feature_collection(features: list[Feature]) -> FeatureCollection:
    return FeatureCollection(features=features)


def route_out(
    route: RouteResult,
    *,
    strategy: str,
    origin_node_id,
    destination_node_id,
    origin_snap_distance_meters: float,
    destination_snap_distance_meters: float,
) -> RouteOut:
    return RouteOut(
        node_ids=list(route.node_ids),
        segment_ids=list(route.segment_ids),
        geometry=linestring_geometry(route.geometry) if route.geometry else None,
        total_distance_meters=route.total_distance_meters,
        strategy=strategy,
        origin_node_id=origin_node_id,
        destination_node_id=destination_node_id,
        origin_snap_distance_meters=origin_snap_distance_meters,
        destination_snap_distance_meters=destination_snap_distance_meters,
    )
