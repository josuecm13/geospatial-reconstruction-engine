"""Spatial-query endpoints (design.md Decision 8): radius, bounding-box,
nearest, and footprint-area, scoped to one completed import area."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies import completed_import_area, get_session
from app.api.errors import ApiError
from app.api.mappers import area_feature_feature, building_feature, node_feature, poi_feature, segment_feature_plain
from app.api.schemas import (
    BboxEntityKind,
    BboxMode,
    EntityKind,
    FootprintAreaOut,
    NearbyOut,
    NearestKind,
    NearestOut,
    WithinBboxOut,
)
from app.domain.bounding_box import BoundingBox, Coordinate, InvalidBoundingBox
from app.domain.import_area import ImportArea
from app.persistence.spatial_queries import SpatialQueryService, UnknownImportArea

router = APIRouter(tags=["spatial-queries"])


def _as_coordinate(latitude: float, longitude: float) -> Coordinate:
    try:
        return Coordinate(latitude, longitude)
    except InvalidBoundingBox as exc:
        raise ApiError(422, "invalid_coordinate", str(exc)) from exc


@router.get("/import-areas/{import_area_id}/nearby", response_model=NearbyOut)
def nearby(
    latitude: float = Query(...),
    longitude: float = Query(...),
    radius_meters: float = Query(...),
    kind: EntityKind = Query(...),
    area: ImportArea = Depends(completed_import_area),
    session: Session = Depends(get_session),
) -> NearbyOut:
    coordinate = _as_coordinate(latitude, longitude)
    service = SpatialQueryService(session)
    dispatch = {
        EntityKind.NODE: (service.nodes_within_radius, node_feature),
        EntityKind.POI: (service.pois_within_radius, poi_feature),
        EntityKind.BUILDING: (service.buildings_within_radius, building_feature),
        EntityKind.AREA_FEATURE: (service.area_features_within_radius, area_feature_feature),
    }
    query_fn, mapper = dispatch[kind]
    results = query_fn(area.id, coordinate, radius_meters)
    return NearbyOut(results=[mapper(item) for item in results])


@router.get("/import-areas/{import_area_id}/within-bbox", response_model=WithinBboxOut)
def within_bbox(
    min_latitude: float = Query(...),
    min_longitude: float = Query(...),
    max_latitude: float = Query(...),
    max_longitude: float = Query(...),
    kind: BboxEntityKind = Query(...),
    mode: BboxMode = Query(...),
    area: ImportArea = Depends(completed_import_area),
    session: Session = Depends(get_session),
) -> WithinBboxOut:
    # Reuses BoundingBox's own validation (strict ordering, 1 km² cap) — the
    # query box obeys the same rule as an import box (spatial-query-api spec).
    bbox = BoundingBox(
        min_corner=Coordinate(min_latitude, min_longitude), max_corner=Coordinate(max_latitude, max_longitude)
    )
    service = SpatialQueryService(session)
    dispatch = {
        (BboxEntityKind.NODE, BboxMode.INTERSECTS): (service.nodes_intersecting_bbox, node_feature),
        (BboxEntityKind.NODE, BboxMode.CONTAINS): (service.nodes_contained_by_bbox, node_feature),
        (BboxEntityKind.BUILDING, BboxMode.INTERSECTS): (service.buildings_intersecting_bbox, building_feature),
        (BboxEntityKind.BUILDING, BboxMode.CONTAINS): (service.buildings_contained_by_bbox, building_feature),
        (BboxEntityKind.AREA_FEATURE, BboxMode.INTERSECTS): (service.area_features_intersecting_bbox, area_feature_feature),
        (BboxEntityKind.AREA_FEATURE, BboxMode.CONTAINS): (service.area_features_contained_by_bbox, area_feature_feature),
    }
    query_fn, mapper = dispatch[(kind, mode)]
    results = query_fn(area.id, bbox)
    return WithinBboxOut(results=[mapper(item) for item in results])


@router.get("/import-areas/{import_area_id}/nearest", response_model=NearestOut)
def nearest(
    latitude: float = Query(...),
    longitude: float = Query(...),
    kind: NearestKind = Query(...),
    area: ImportArea = Depends(completed_import_area),
    session: Session = Depends(get_session),
) -> NearestOut:
    coordinate = _as_coordinate(latitude, longitude)
    service = SpatialQueryService(session)
    if kind is NearestKind.NODE:
        node = service.nearest_node(area.id, coordinate)
        return NearestOut(result=node_feature(node) if node is not None else None)
    segment = service.nearest_segment(area.id, coordinate)
    return NearestOut(result=segment_feature_plain(segment) if segment is not None else None)


@router.get("/import-areas/{import_area_id}/buildings/{building_id}/footprint-area", response_model=FootprintAreaOut)
def footprint_area(
    building_id: uuid.UUID,
    area: ImportArea = Depends(completed_import_area),
    session: Session = Depends(get_session),
) -> FootprintAreaOut:
    try:
        area_square_meters = SpatialQueryService(session).building_footprint_area_square_meters(area.id, building_id)
    except UnknownImportArea as exc:
        # completed_import_area already proved the area exists, so this
        # UnknownImportArea can only mean the building isn't in it.
        raise ApiError(404, "building_not_found", f"building {building_id} not found in import area {area.id}") from exc
    return FootprintAreaOut(building_id=building_id, area_square_meters=area_square_meters)
