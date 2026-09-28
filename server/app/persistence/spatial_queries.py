import uuid

from geoalchemy2 import Geography
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.domain.area_feature import AreaFeature
from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.building import Building
from app.domain.poi import PointOfInterest
from app.domain.road_graph import NavigableNode, RoadSegment
from app.persistence.geometry import bbox_to_geom, point_to_geom
from app.persistence.models import (
    AreaFeatureModel,
    BuildingModel,
    ImportAreaModel,
    NavigableNodeModel,
    PointOfInterestModel,
    RoadModel,
    RoadSegmentModel,
    TracedBoundaryModel,
)
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.poi import PointOfInterestRepository
from app.persistence.repositories.road_graph import NavigableNodeRepository, RoadSegmentRepository


class UnknownImportArea(ValueError):
    """Raised when a spatial query names an import area, or an entity within one, that does not exist."""


class UnknownTracedBoundary(ValueError):
    """Raised when a query is scoped to a traced boundary that doesn't exist in its import area."""


class InvalidSpatialQuery(ValueError):
    """Raised when a spatial query's own parameters are malformed (not merely a query that finds nothing)."""


class SpatialQueryService:
    """Every query except the footprint area takes an optional `boundary_id`. When it is
    set, only entities whose geometry intersects that traced boundary are considered."""

    def __init__(self, session: Session):
        self.session = session

    def nodes_within_radius(
        self, import_area_id: uuid.UUID, center: Coordinate, radius_meters: float, boundary_id: uuid.UUID | None = None
    ) -> list[NavigableNode]:
        return self._within_radius(
            NavigableNodeModel, import_area_id, center, radius_meters, NavigableNodeRepository._to_domain, boundary_id
        )

    def pois_within_radius(
        self, import_area_id: uuid.UUID, center: Coordinate, radius_meters: float, boundary_id: uuid.UUID | None = None
    ) -> list[PointOfInterest]:
        return self._within_radius(
            PointOfInterestModel, import_area_id, center, radius_meters, PointOfInterestRepository._to_domain, boundary_id
        )

    def buildings_within_radius(
        self, import_area_id: uuid.UUID, center: Coordinate, radius_meters: float, boundary_id: uuid.UUID | None = None
    ) -> list[Building]:
        return self._within_radius(
            BuildingModel, import_area_id, center, radius_meters, BuildingRepository._to_domain, boundary_id
        )

    def area_features_within_radius(
        self, import_area_id: uuid.UUID, center: Coordinate, radius_meters: float, boundary_id: uuid.UUID | None = None
    ) -> list[AreaFeature]:
        return self._within_radius(
            AreaFeatureModel, import_area_id, center, radius_meters, AreaFeatureRepository._to_domain, boundary_id
        )

    def buildings_intersecting_bbox(
        self, import_area_id: uuid.UUID, bbox: BoundingBox, boundary_id: uuid.UUID | None = None
    ) -> list[Building]:
        return self._intersecting_bbox(BuildingModel, import_area_id, bbox, BuildingRepository._to_domain, boundary_id)

    def buildings_contained_by_bbox(
        self, import_area_id: uuid.UUID, bbox: BoundingBox, boundary_id: uuid.UUID | None = None
    ) -> list[Building]:
        return self._contained_by_bbox(BuildingModel, import_area_id, bbox, BuildingRepository._to_domain, boundary_id)

    def area_features_intersecting_bbox(
        self, import_area_id: uuid.UUID, bbox: BoundingBox, boundary_id: uuid.UUID | None = None
    ) -> list[AreaFeature]:
        return self._intersecting_bbox(AreaFeatureModel, import_area_id, bbox, AreaFeatureRepository._to_domain, boundary_id)

    def area_features_contained_by_bbox(
        self, import_area_id: uuid.UUID, bbox: BoundingBox, boundary_id: uuid.UUID | None = None
    ) -> list[AreaFeature]:
        return self._contained_by_bbox(AreaFeatureModel, import_area_id, bbox, AreaFeatureRepository._to_domain, boundary_id)

    def nodes_intersecting_bbox(
        self, import_area_id: uuid.UUID, bbox: BoundingBox, boundary_id: uuid.UUID | None = None
    ) -> list[NavigableNode]:
        return self._intersecting_bbox(NavigableNodeModel, import_area_id, bbox, NavigableNodeRepository._to_domain, boundary_id)

    def nodes_contained_by_bbox(
        self, import_area_id: uuid.UUID, bbox: BoundingBox, boundary_id: uuid.UUID | None = None
    ) -> list[NavigableNode]:
        return self._contained_by_bbox(NavigableNodeModel, import_area_id, bbox, NavigableNodeRepository._to_domain, boundary_id)

    def building_footprint_area_square_meters(self, import_area_id: uuid.UUID, building_id: uuid.UUID) -> float:
        self._require_import_area(import_area_id)
        area = self.session.execute(
            select(func.ST_Area(cast(BuildingModel.geom, Geography))).where(
                BuildingModel.id == building_id,
                BuildingModel.import_area_id == import_area_id,
            )
        ).scalar_one_or_none()
        if area is None:
            raise UnknownImportArea(f"building {building_id} not found in import area {import_area_id}")
        return area

    def nearest_node(
        self, import_area_id: uuid.UUID, coordinate: Coordinate, boundary_id: uuid.UUID | None = None
    ) -> NavigableNode | None:
        self._require_import_area(import_area_id)
        point = point_to_geom(coordinate)
        model = self.session.execute(
            select(NavigableNodeModel)
            .where(
                NavigableNodeModel.import_area_id == import_area_id,
                *self._scope(NavigableNodeModel.geom, import_area_id, boundary_id),
            )
            .order_by(
                func.ST_Distance(cast(NavigableNodeModel.geom, Geography), cast(point, Geography)),
                NavigableNodeModel.id,
            )
            .limit(1)
        ).scalar_one_or_none()
        return NavigableNodeRepository._to_domain(model) if model is not None else None

    def nearest_segment(
        self, import_area_id: uuid.UUID, coordinate: Coordinate, boundary_id: uuid.UUID | None = None
    ) -> RoadSegment | None:
        self._require_import_area(import_area_id)
        point = point_to_geom(coordinate)
        model = self.session.execute(
            select(RoadSegmentModel)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .where(
                RoadModel.import_area_id == import_area_id,
                *self._scope(RoadSegmentModel.geom, import_area_id, boundary_id),
            )
            .order_by(func.ST_Distance(cast(RoadSegmentModel.geom, Geography), cast(point, Geography)))
            .limit(1)
        ).scalar_one_or_none()
        return RoadSegmentRepository._to_domain(model) if model is not None else None

    def _within_radius(self, model, import_area_id, center: Coordinate, radius_meters: float, to_domain, boundary_id):
        self._require_import_area(import_area_id)
        self._require_positive_radius(radius_meters)
        point = point_to_geom(center)
        rows = self.session.execute(
            select(model).where(
                model.import_area_id == import_area_id,
                func.ST_DWithin(cast(model.geom, Geography), cast(point, Geography), radius_meters),
                *self._scope(model.geom, import_area_id, boundary_id),
            )
        ).scalars().all()
        return [to_domain(row) for row in rows]

    def _intersecting_bbox(self, model, import_area_id, bbox: BoundingBox, to_domain, boundary_id):
        self._require_import_area(import_area_id)
        bbox_geom = bbox_to_geom(bbox)
        rows = self.session.execute(
            select(model).where(
                model.import_area_id == import_area_id,
                func.ST_Intersects(model.geom, bbox_geom),
                *self._scope(model.geom, import_area_id, boundary_id),
            )
        ).scalars().all()
        return [to_domain(row) for row in rows]

    def _contained_by_bbox(self, model, import_area_id, bbox: BoundingBox, to_domain, boundary_id):
        self._require_import_area(import_area_id)
        bbox_geom = bbox_to_geom(bbox)
        rows = self.session.execute(
            select(model).where(
                model.import_area_id == import_area_id,
                func.ST_Contains(bbox_geom, model.geom),
                *self._scope(model.geom, import_area_id, boundary_id),
            )
        ).scalars().all()
        return [to_domain(row) for row in rows]

    def _scope(self, geom_column, import_area_id: uuid.UUID, boundary_id: uuid.UUID | None) -> list:
        """The extra WHERE clauses for a boundary scope: none without one."""
        if boundary_id is None:
            return []
        boundary_geom = self.session.execute(
            select(TracedBoundaryModel.geom).where(
                TracedBoundaryModel.id == boundary_id,
                TracedBoundaryModel.import_area_id == import_area_id,
            )
        ).scalar_one_or_none()
        if boundary_geom is None:
            raise UnknownTracedBoundary(f"boundary {boundary_id} not found in import area {import_area_id}")
        return [func.ST_Intersects(geom_column, boundary_geom)]

    def _require_import_area(self, import_area_id: uuid.UUID) -> None:
        exists = self.session.execute(
            select(ImportAreaModel.id).where(ImportAreaModel.id == import_area_id)
        ).scalar_one_or_none()
        if exists is None:
            raise UnknownImportArea(f"import area {import_area_id} does not exist")

    @staticmethod
    def _require_positive_radius(radius_meters: float) -> None:
        if radius_meters <= 0:
            raise InvalidSpatialQuery(f"radius_meters must be positive, got {radius_meters}")
