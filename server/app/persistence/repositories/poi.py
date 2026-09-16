from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import PoiCategory
from app.domain.poi import PointOfInterest
from app.persistence.geometry import geom_to_point, point_to_geom
from app.persistence.models import PointOfInterestModel


class PointOfInterestRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, poi: PointOfInterest) -> PointOfInterest:
        model = self.session.execute(
            select(PointOfInterestModel).where(
                PointOfInterestModel.import_area_id == poi.import_area_id,
                PointOfInterestModel.source_id == poi.source_id,
            )
        ).scalar_one_or_none()

        geom = point_to_geom(poi.point)
        if model is None:
            model = PointOfInterestModel(
                import_area_id=poi.import_area_id,
                source_id=poi.source_id,
                category=poi.category,
                name=poi.name,
                geom=geom,
            )
            self.session.add(model)
        else:
            model.category = poi.category
            model.name = poi.name
            model.geom = geom

        self.session.flush()
        return self._to_domain(model)

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
