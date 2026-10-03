from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.area_feature import AreaFeature
from app.domain.enums import AreaFeatureKind
from app.persistence.geometry import geom_to_polygon, polygon_to_geom
from app.persistence.models import AreaFeatureModel
from app.persistence.repositories.batching import chunked


class AreaFeatureRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, area_feature: AreaFeature) -> AreaFeature:
        return self.upsert_many(area_feature.import_area_id, [area_feature])[area_feature.source_id]

    def upsert_many(self, import_area_id, items: Iterable[AreaFeature]) -> dict[str, AreaFeature]:
        """By source id. One SELECT of the existing rows, add or mutate, one flush. Two items with
        the same source id update the same row, as sequential upserts would."""
        items = list(items)
        models: dict[str, AreaFeatureModel] = {}
        for source_ids in chunked({item.source_id for item in items}):
            for model in self.session.execute(
                select(AreaFeatureModel).where(
                    AreaFeatureModel.import_area_id == import_area_id, AreaFeatureModel.source_id.in_(source_ids)
                )
            ).scalars():
                models[model.source_id] = model

        for area_feature in items:
            geom = polygon_to_geom(area_feature.geom)
            model = models.get(area_feature.source_id)
            if model is None:
                model = AreaFeatureModel(
                    import_area_id=area_feature.import_area_id,
                    source_id=area_feature.source_id,
                    kind=area_feature.kind,
                    geom=geom,
                )
                self.session.add(model)
                models[area_feature.source_id] = model
            else:
                model.kind = area_feature.kind
                model.geom = geom

        self.session.flush()
        return {source_id: self._to_domain(model) for source_id, model in models.items()}

    def list_for_import_area(self, import_area_id) -> list[AreaFeature]:
        models = self.session.execute(
            select(AreaFeatureModel).where(AreaFeatureModel.import_area_id == import_area_id)
        ).scalars().all()
        return [self._to_domain(model) for model in models]

    @staticmethod
    def _to_domain(model: AreaFeatureModel) -> AreaFeature:
        return AreaFeature(
            id=model.id,
            import_area_id=model.import_area_id,
            source_id=model.source_id,
            kind=AreaFeatureKind(model.kind),
            geom=geom_to_polygon(model.geom),
        )
