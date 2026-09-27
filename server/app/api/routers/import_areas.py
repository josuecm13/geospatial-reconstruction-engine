"""Import-area endpoints (design.md Decision 8): import, status/count lookup,
and whole-area map data."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import completed_import_area, get_session, import_area as import_area_dependency
from app.api.errors import ApiError
from app.api.mappers import (
    area_feature_feature,
    block_feature,
    building_feature,
    feature_collection,
    import_area_out,
    node_feature,
    poi_feature,
    segment_feature,
)
from app.api.schemas import ImportAreaCreate, ImportAreaOut, MapDataOut
from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.cross_section import cross_sections_by_segment
from app.domain.import_area import ImportArea
from app.ingestion.service import OSMIngestionService
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.block import BlockRepository
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.poi import PointOfInterestRepository
from app.persistence.repositories.road_graph import NavigableNodeRepository, RoadSegmentRepository

router = APIRouter(tags=["import-areas"])


@router.post("/import-areas", response_model=ImportAreaOut)
def create_import_area(body: ImportAreaCreate, session: Session = Depends(get_session)) -> ImportAreaOut:
    bbox = BoundingBox(
        min_corner=Coordinate(body.bbox.min_latitude, body.bbox.min_longitude),
        max_corner=Coordinate(body.bbox.max_latitude, body.bbox.max_longitude),
    )
    try:
        # Provider is always "osm": only the OSM adapter exists, and a
        # free-form provider string from the client would silently fork
        # import-area identity (design.md Decision 3).
        result = OSMIngestionService(session).import_fixture(bbox, body.payload, provider="osm")
    except IntegrityError as exc:
        session.rollback()
        raise ApiError(
            409, "import_conflict", "a concurrent request already created this import area"
        ) from exc
    return import_area_out(result.import_area, result.block_count, result.linked_building_count)


@router.get("/import-areas/{import_area_id}", response_model=ImportAreaOut)
def get_import_area(
    area: ImportArea = Depends(import_area_dependency), session: Session = Depends(get_session)
) -> ImportAreaOut:
    block_count = ImportAreaRepository(session).block_count(area.id)
    return import_area_out(area, block_count)


@router.get("/import-areas/{import_area_id}/map-data", response_model=MapDataOut)
def get_map_data(
    area: ImportArea = Depends(completed_import_area), session: Session = Depends(get_session)
) -> MapDataOut:
    segments = RoadSegmentRepository(session).list_for_import_area_with_street(area.id)
    cross_sections = cross_sections_by_segment(segments)
    nodes = NavigableNodeRepository(session).list_for_import_area(area.id)
    blocks = BlockRepository(session).list_for_import_area(area.id)
    buildings = BuildingRepository(session).list_for_import_area(area.id)
    pois = PointOfInterestRepository(session).list_for_import_area(area.id)
    area_features = AreaFeatureRepository(session).list_for_import_area(area.id)

    return MapDataOut(
        road_segments=feature_collection(
            [segment_feature(entry, cross_sections[entry.segment.id]) for entry in segments]
        ),
        navigable_nodes=feature_collection([node_feature(node) for node in nodes]),
        blocks=feature_collection([block_feature(block) for block in blocks]),
        buildings=feature_collection([building_feature(building) for building in buildings]),
        pois=feature_collection([poi_feature(poi) for poi in pois]),
        area_features=feature_collection([area_feature_feature(feature) for feature in area_features]),
    )
