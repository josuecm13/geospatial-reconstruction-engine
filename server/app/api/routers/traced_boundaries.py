"""Traced-boundary endpoints (Milestone 8): create, list, fetch, and delete the
named shapes that narrow an import area without changing what it imported."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.dependencies import get_session, import_area, traced_boundary
from app.api.errors import ApiError
from app.api.mappers import boundary_feature, feature_collection
from app.api.schemas import Feature, FeatureCollection, TracedBoundaryCreate
from app.domain.bounding_box import Coordinate, InvalidBoundingBox
from app.domain.geometry import Polygon
from app.domain.import_area import ImportArea
from app.domain.traced_boundary import InvalidTracedBoundary, TracedBoundary
from app.persistence.repositories.traced_boundary import TracedBoundaryRepository

router = APIRouter(tags=["traced-boundaries"])


def _polygon_from_geojson(geometry: dict[str, Any]) -> Polygon:
    """Only the GeoJSON shape is checked here; the ring's own rules are
    `validate_traced_boundary`'s, so they have one implementation."""
    rings = geometry.get("coordinates")
    if geometry.get("type") != "Polygon" or not isinstance(rings, list) or not rings:
        raise InvalidTracedBoundary("invalid_geojson", "geometry must be a GeoJSON Polygon with at least one ring")
    if len(rings) > 1:
        raise InvalidTracedBoundary("holes_not_supported", "a boundary is a single ring; holes are not supported")
    ring = rings[0]
    if not isinstance(ring, list) or not all(
        isinstance(position, list)
        and len(position) == 2
        and all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in position)
        for position in ring
    ):
        raise InvalidTracedBoundary("invalid_geojson", "every position must be [longitude, latitude]")
    try:
        return tuple(Coordinate(latitude=latitude, longitude=longitude) for longitude, latitude in ring)
    except InvalidBoundingBox as exc:
        raise ApiError(422, "invalid_coordinate", str(exc)) from exc


@router.post("/import-areas/{import_area_id}/boundaries", status_code=201, response_model=Feature)
def create_boundary(
    body: TracedBoundaryCreate,
    area: ImportArea = Depends(import_area),
    session: Session = Depends(get_session),
) -> Feature:
    polygon = _polygon_from_geojson(body.geometry)
    boundary = TracedBoundaryRepository(session).create(area, body.name, polygon)
    session.commit()
    return boundary_feature(boundary)


@router.get("/import-areas/{import_area_id}/boundaries", response_model=FeatureCollection)
def list_boundaries(
    area: ImportArea = Depends(import_area), session: Session = Depends(get_session)
) -> FeatureCollection:
    boundaries = TracedBoundaryRepository(session).list_for_import_area(area.id)
    return feature_collection([boundary_feature(boundary) for boundary in boundaries])


@router.get("/import-areas/{import_area_id}/boundaries/{boundary_id}", response_model=Feature)
def get_boundary(boundary: TracedBoundary = Depends(traced_boundary)) -> Feature:
    return boundary_feature(boundary)


@router.delete("/import-areas/{import_area_id}/boundaries/{boundary_id}", status_code=204)
def delete_boundary(
    boundary: TracedBoundary = Depends(traced_boundary), session: Session = Depends(get_session)
) -> Response:
    TracedBoundaryRepository(session).delete(boundary.id)
    session.commit()
    return Response(status_code=204)
