import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import ImportStatus
from app.domain.import_area import ImportArea
from app.persistence.geometry import bbox_to_geom
from app.persistence.models import BlockModel, ImportAreaModel


class ImportAreaRepository:
    def __init__(self, session: Session):
        self.session = session

    def get(self, import_area_id: uuid.UUID) -> ImportArea | None:
        model = self.session.get(ImportAreaModel, import_area_id)
        return self._to_domain(model) if model is not None else None

    def list_recent(self, status: ImportStatus | None = None, limit: int = 50) -> list[tuple[ImportArea, int]]:
        """Import areas, most recently imported first (an area that never completed an import
        sorts by when it was created), each with its block count."""
        block_counts = (
            select(BlockModel.import_area_id, func.count().label("block_count"))
            .group_by(BlockModel.import_area_id)
            .subquery()
        )
        query = (
            select(ImportAreaModel, func.coalesce(block_counts.c.block_count, 0))
            .outerjoin(block_counts, block_counts.c.import_area_id == ImportAreaModel.id)
            .order_by(
                func.coalesce(ImportAreaModel.imported_at, ImportAreaModel.created_at).desc(), ImportAreaModel.id
            )
            .limit(limit)
        )
        if status is not None:
            query = query.where(ImportAreaModel.status == status)
        return [(self._to_domain(model), count) for model, count in self.session.execute(query).all()]

    def block_count(self, import_area_id: uuid.UUID) -> int:
        return self.session.scalar(
            select(func.count()).select_from(BlockModel).where(BlockModel.import_area_id == import_area_id)
        )

    def find(self, provider: str, bbox: BoundingBox) -> ImportArea | None:
        existing = self._find_model(provider, bbox)
        return self._to_domain(existing) if existing is not None else None

    def _find_model(self, provider: str, bbox: BoundingBox) -> ImportAreaModel | None:
        return self.session.execute(
            select(ImportAreaModel).where(
                ImportAreaModel.provider == provider,
                ImportAreaModel.min_longitude == bbox.min_corner.longitude,
                ImportAreaModel.min_latitude == bbox.min_corner.latitude,
                ImportAreaModel.max_longitude == bbox.max_corner.longitude,
                ImportAreaModel.max_latitude == bbox.max_corner.latitude,
            )
        ).scalar_one_or_none()

    def completed_areas_covered_by(self, bbox: BoundingBox, exclude_id: uuid.UUID | None = None) -> list[ImportArea]:
        """Completed areas whose bounding box lies entirely inside `bbox` (edges may touch): the
        inner areas an import of `bbox` skips. A partly overlapping area is not one of them."""
        query = (
            select(ImportAreaModel)
            .where(
                ImportAreaModel.status == ImportStatus.COMPLETED,
                func.ST_CoveredBy(ImportAreaModel.bbox, bbox_to_geom(bbox)),
            )
            .order_by(ImportAreaModel.min_latitude, ImportAreaModel.min_longitude, ImportAreaModel.id)
        )
        if exclude_id is not None:
            query = query.where(ImportAreaModel.id != exclude_id)
        return [self._to_domain(model) for model in self.session.execute(query).scalars().all()]

    def get_or_create(self, provider: str, bbox: BoundingBox) -> ImportArea:
        existing = self._find_model(provider, bbox)
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

    def set_place(self, import_area_id: uuid.UUID, name: str | None, context: str | None) -> ImportArea:
        """Stores the area's place name. An answer with neither part keeps what is stored."""
        model = self.session.get(ImportAreaModel, import_area_id)
        if model is None:
            raise ValueError(f"import area {import_area_id} not found")
        if name is not None or context is not None:
            model.place_name = name
            model.place_context = context
            self.session.flush()
        return self._to_domain(model)

    def list_without_place(self) -> list[ImportArea]:
        query = (
            select(ImportAreaModel)
            .where(ImportAreaModel.place_name.is_(None))
            .order_by(ImportAreaModel.created_at, ImportAreaModel.id)
        )
        return [self._to_domain(model) for model in self.session.execute(query).scalars().all()]

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
            place_name=model.place_name,
            place_context=model.place_context,
        )
