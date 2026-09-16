from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.area_feature import AreaFeature
from app.domain.enums import AreaFeatureKind
from app.persistence.geometry import geom_to_polygon, polygon_to_geom
from app.persistence.models import AreaFeatureModel


class AreaFeatureRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, area_feature: AreaFeature) -> AreaFeature:
        model = self.session.execute(
            select(AreaFeatureModel).where(
                AreaFeatureModel.import_area_id == area_feature.import_area_id,
                AreaFeatureModel.source_id == area_feature.source_id,
            )
        ).scalar_one_or_none()

        geom = polygon_to_geom(area_feature.geom)
        if model is None:
            model = AreaFeatureModel(
                import_area_id=area_feature.import_area_id,
                source_id=area_feature.source_id,
                kind=area_feature.kind,
                geom=geom,
            )
            self.session.add(model)
        else:
            model.kind = area_feature.kind
            model.geom = geom

        self.session.flush()
        return self._to_domain(model)

    @staticmethod
    def _to_domain(model: AreaFeatureModel) -> AreaFeature:
        return AreaFeature(
            id=model.id,
            import_area_id=model.import_area_id,
            source_id=model.source_id,
            kind=AreaFeatureKind(model.kind),
            geom=geom_to_polygon(model.geom),
        )
