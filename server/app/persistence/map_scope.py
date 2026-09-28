import uuid
from dataclasses import dataclass
from typing import Any

from geoalchemy2 import Geometry
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.persistence.models import (
    AreaFeatureModel,
    BlockModel,
    BuildingModel,
    ImportAreaModel,
    NavigableNodeModel,
    PointOfInterestModel,
    RoadModel,
    RoadSegmentModel,
    TracedBoundaryModel,
)


@dataclass(frozen=True)
class ScopedIds:
    """The ids, per map-data layer, of the entities whose geometry intersects a boundary."""

    road_segments: frozenset[uuid.UUID]
    navigable_nodes: frozenset[uuid.UUID]
    blocks: frozenset[uuid.UUID]
    buildings: frozenset[uuid.UUID]
    pois: frozenset[uuid.UUID]
    area_features: frozenset[uuid.UUID]


def ids_intersecting_boundary(session: Session, import_area_id: uuid.UUID, boundary_id: uuid.UUID) -> ScopedIds:
    """Uses the stored boundary geometry, so the test is the same one the spatial queries apply.
    Callers check first that the boundary belongs to the import area."""
    boundary_geom = (
        select(TracedBoundaryModel.geom).where(TracedBoundaryModel.id == boundary_id).scalar_subquery()
    )

    def ids(model, geom_column):
        return frozenset(
            session.scalars(
                select(model.id).where(
                    model.import_area_id == import_area_id, func.ST_Intersects(geom_column, boundary_geom)
                )
            ).all()
        )

    segment_ids = frozenset(
        session.scalars(
            select(RoadSegmentModel.id)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .where(RoadModel.import_area_id == import_area_id, func.ST_Intersects(RoadSegmentModel.geom, boundary_geom))
        ).all()
    )
    return ScopedIds(
        road_segments=segment_ids,
        navigable_nodes=ids(NavigableNodeModel, NavigableNodeModel.geom),
        blocks=ids(BlockModel, BlockModel.boundary),
        buildings=ids(BuildingModel, BuildingModel.geom),
        pois=ids(PointOfInterestModel, PointOfInterestModel.geom),
        area_features=ids(AreaFeatureModel, AreaFeatureModel.geom),
    )


# ST_CollectionExtract's type codes: an entity keeps only the parts of its own dimension.
_POINTS, _LINES, _POLYGONS = 1, 2, 3


@dataclass(frozen=True)
class ClippedGeometries:
    """GeoJSON geometries cut at a scope, per map-data layer, keyed by entity id. An entity
    whose intersection has nothing of its own dimension left (a building that only touches
    the edge leaves a line) is absent. `block_buildable_areas` holds the clipped buildable
    area of each block that still has one."""

    road_segments: dict[uuid.UUID, dict[str, Any]]
    navigable_nodes: dict[uuid.UUID, dict[str, Any]]
    blocks: dict[uuid.UUID, dict[str, Any]]
    block_buildable_areas: dict[uuid.UUID, dict[str, Any]]
    buildings: dict[uuid.UUID, dict[str, Any]]
    pois: dict[uuid.UUID, dict[str, Any]]
    area_features: dict[uuid.UUID, dict[str, Any]]


def clip_to_scope(session: Session, import_area_id: uuid.UUID, boundary_id: uuid.UUID | None) -> ClippedGeometries:
    """Cuts every layer at the boundary, or at the import area's bounding box without one."""
    if boundary_id is None:
        scope_geom = select(ImportAreaModel.bbox).where(ImportAreaModel.id == import_area_id).scalar_subquery()
    else:
        scope_geom = select(TracedBoundaryModel.geom).where(TracedBoundaryModel.id == boundary_id).scalar_subquery()

    def clip(model, geom_column, dimension, *joins_and_filters, owner=None):
        clipped = func.ST_CollectionExtract(func.ST_Intersection(geom_column, scope_geom), dimension, type_=Geometry)
        query = select(model.id, clipped)
        for join in joins_and_filters:
            query = query.join(*join)
        query = query.where(
            (owner if owner is not None else model.import_area_id) == import_area_id,
            func.ST_Intersects(geom_column, scope_geom),
        )
        result = {}
        for entity_id, geom in session.execute(query).all():
            if geom is None:
                continue
            shape = to_shape(geom)
            if not shape.is_empty:
                result[entity_id] = _geojson(shape)
        return result

    return ClippedGeometries(
        road_segments=clip(
            RoadSegmentModel, RoadSegmentModel.geom, _LINES,
            (RoadModel, RoadSegmentModel.road_id == RoadModel.id), owner=RoadModel.import_area_id,
        ),
        navigable_nodes=clip(NavigableNodeModel, NavigableNodeModel.geom, _POINTS),
        blocks=clip(BlockModel, BlockModel.boundary, _POLYGONS),
        block_buildable_areas=clip(BlockModel, BlockModel.buildable_area, _POLYGONS),
        buildings=clip(BuildingModel, BuildingModel.geom, _POLYGONS),
        pois=clip(PointOfInterestModel, PointOfInterestModel.geom, _POINTS),
        area_features=clip(AreaFeatureModel, AreaFeatureModel.geom, _POLYGONS),
    )


def _geojson(shape) -> dict[str, Any]:
    """`mapping()` nests tuples; the rest of the API emits lists, so convert them."""

    def lists(value):
        return [lists(item) for item in value] if isinstance(value, (list, tuple)) else value

    geometry = mapping(shape)
    return {"type": geometry["type"], "coordinates": lists(geometry["coordinates"])}
