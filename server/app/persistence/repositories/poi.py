from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import PoiCategory
from app.domain.poi import PointOfInterest
from app.persistence.geometry import geom_to_point, point_to_geom
from app.persistence.models import PointOfInterestModel
from app.persistence.repositories.batching import chunked


class PointOfInterestRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, poi: PointOfInterest) -> PointOfInterest:
        return self.upsert_many(poi.import_area_id, [poi])[poi.source_id]

    def upsert_many(self, import_area_id, items: Iterable[PointOfInterest]) -> dict[str, PointOfInterest]:
        """By source id. One SELECT of the existing rows, add or mutate, one flush. Two items with
        the same source id update the same row, as sequential upserts would."""
        items = list(items)
        models: dict[str, PointOfInterestModel] = {}
        for source_ids in chunked({item.source_id for item in items}):
            for model in self.session.execute(
                select(PointOfInterestModel).where(
                    PointOfInterestModel.import_area_id == import_area_id,
                    PointOfInterestModel.source_id.in_(source_ids),
                )
            ).scalars():
                models[model.source_id] = model

        for poi in items:
            geom = point_to_geom(poi.point)
            model = models.get(poi.source_id)
            if model is None:
                model = PointOfInterestModel(
                    import_area_id=poi.import_area_id,
                    source_id=poi.source_id,
                    category=poi.category,
                    name=poi.name,
                    geom=geom,
                )
                self.session.add(model)
                models[poi.source_id] = model
            else:
                model.category = poi.category
                model.name = poi.name
                model.geom = geom

        self.session.flush()
        return {source_id: self._to_domain(model) for source_id, model in models.items()}

    def list_for_import_area(self, import_area_id) -> list[PointOfInterest]:
        models = self.session.execute(
            select(PointOfInterestModel).where(PointOfInterestModel.import_area_id == import_area_id)
        ).scalars().all()
        return [self._to_domain(model) for model in models]

    @staticmethod
    def _to_domain(model: PointOfInterestModel) -> PointOfInterest:
        return PointOfInterest(
            id=model.id,
            import_area_id=model.import_area_id,
            source_id=model.source_id,
            category=PoiCategory(model.category),
            point=geom_to_point(model.geom),
            name=model.name,
        )
