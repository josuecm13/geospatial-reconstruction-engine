import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.persistence.models import (
    AreaFeatureModel,
    BlockModel,
    BuildingModel,
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
