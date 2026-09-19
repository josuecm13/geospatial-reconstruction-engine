import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import ImportStatus
from app.domain.import_area import ImportArea
from app.persistence.geometry import bbox_to_geom
from app.persistence.models import ImportAreaModel


class ImportAreaRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_or_create(self, provider: str, bbox: BoundingBox) -> ImportArea:
        existing = self.session.execute(
            select(ImportAreaModel).where(
                ImportAreaModel.provider == provider,
                ImportAreaModel.min_longitude == bbox.min_corner.longitude,
                ImportAreaModel.min_latitude == bbox.min_corner.latitude,
                ImportAreaModel.max_longitude == bbox.max_corner.longitude,
                ImportAreaModel.max_latitude == bbox.max_corner.latitude,
            )
        ).scalar_one_or_none()

        if existing is not None:
            return self._to_domain(existing)

        model = ImportAreaModel(
            provider=provider,
            min_longitude=bbox.min_corner.longitude,
            min_latitude=bbox.min_corner.latitude,
            max_longitude=bbox.max_corner.longitude,
            max_latitude=bbox.max_corner.latitude,
            bbox=bbox_to_geom(bbox),
            status=ImportStatus.PENDING,
        )
        self.session.add(model)
        self.session.flush()
        return self._to_domain(model)

    def mark_completed(
        self,
        import_area_id: uuid.UUID,
        *,
        road_count: int,
        node_count: int,
        building_count: int,
        poi_count: int,
        area_feature_count: int,
    ) -> ImportArea:
        model = self.session.get(ImportAreaModel, import_area_id)
        if model is None:
            raise ValueError(f"import area {import_area_id} not found")

        model.status = ImportStatus.COMPLETED
        model.road_count = road_count
        model.node_count = node_count
        model.building_count = building_count
        model.poi_count = poi_count
        model.area_feature_count = area_feature_count
        model.imported_at = datetime.now(timezone.utc)
        self.session.flush()
        return self._to_domain(model)

    def mark_importing(self, import_area_id: uuid.UUID) -> ImportArea:
        model = self.session.get(ImportAreaModel, import_area_id)
        if model is None:
            raise ValueError(f"import area {import_area_id} not found")
        model.status = ImportStatus.IMPORTING
        self.session.flush()
        return self._to_domain(model)

    def mark_failed(self, import_area_id: uuid.UUID) -> ImportArea:
        model = self.session.get(ImportAreaModel, import_area_id)
        if model is None:
            raise ValueError(f"import area {import_area_id} not found")
        model.status = ImportStatus.FAILED
        self.session.flush()
        return self._to_domain(model)

    @staticmethod
    def _to_domain(model: ImportAreaModel) -> ImportArea:
        bbox = BoundingBox(
            min_corner=Coordinate(model.min_latitude, model.min_longitude),
            max_corner=Coordinate(model.max_latitude, model.max_longitude),
        )
        return ImportArea(
            id=model.id,
            provider=model.provider,
            bbox=bbox,
            status=ImportStatus(model.status),
            road_count=model.road_count,
            node_count=model.node_count,
            building_count=model.building_count,
            poi_count=model.poi_count,
            area_feature_count=model.area_feature_count,
            imported_at=model.imported_at,
        )
