from collections.abc import Iterable

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.domain.building import Building
from app.domain.enums import BuildingCategory
from app.persistence.geometry import geom_to_polygon, polygon_to_geom
from app.persistence.models import BuildingModel
from app.persistence.repositories.batching import chunked


class BuildingRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, building: Building) -> Building:
        return self.upsert_many(building.import_area_id, [building])[building.source_id]

    def upsert_many(self, import_area_id, items: Iterable[Building]) -> dict[str, Building]:
        """By source id. One SELECT of the existing rows, add or mutate, one flush. Two items with
        the same source id update the same row, as sequential upserts would."""
        items = list(items)
        models: dict[str, BuildingModel] = {}
        for source_ids in chunked({item.source_id for item in items}):
            for model in self.session.execute(
                select(BuildingModel).where(
                    BuildingModel.import_area_id == import_area_id, BuildingModel.source_id.in_(source_ids)
                )
            ).scalars():
                models[model.source_id] = model

        for building in items:
            geom = polygon_to_geom(building.geom)
            model = models.get(building.source_id)
            if model is None:
                model = BuildingModel(
                    import_area_id=building.import_area_id,
                    source_id=building.source_id,
                    category=building.category,
                    geom=geom,
                    block_id=building.block_id,
                    height_meters=building.height_meters,
                    levels=building.levels,
                )
                self.session.add(model)
                models[building.source_id] = model
            else:
                model.category = building.category
                model.geom = geom
                model.block_id = building.block_id
                model.height_meters = building.height_meters
                model.levels = building.levels

        self.session.flush()
        return {source_id: self._to_domain(model) for source_id, model in models.items()}

    def link_to_containing_block(self, import_area_id) -> int:
        result = self.session.execute(
            text(
                """
                UPDATE buildings b
                SET block_id = blk.id
                FROM blocks blk
                WHERE b.import_area_id = :import_area_id
                  AND blk.import_area_id = :import_area_id
                  AND ST_Contains(blk.boundary, b.geom)
                """
            ),
            {"import_area_id": str(import_area_id)},
        )
        self.session.flush()
        # The raw UPDATE bypasses the identity map, so any building of this area the session has
        # already loaded keeps its old block_id. Expire just that column so the next read reloads it.
        for obj in list(self.session.identity_map.values()):
            if isinstance(obj, BuildingModel) and obj.import_area_id == import_area_id:
                self.session.expire(obj, ["block_id"])
        return result.rowcount

    def list_for_import_area(self, import_area_id) -> list[Building]:
        models = self.session.execute(
            select(BuildingModel).where(BuildingModel.import_area_id == import_area_id)
        ).scalars().all()
        return [self._to_domain(model) for model in models]

    def get(self, building_id) -> Building | None:
        model = self.session.get(BuildingModel, building_id)
        return self._to_domain(model) if model is not None else None

    @staticmethod
    def _to_domain(model: BuildingModel) -> Building:
        return Building(
            id=model.id,
            import_area_id=model.import_area_id,
            source_id=model.source_id,
            category=BuildingCategory(model.category),
            geom=geom_to_polygon(model.geom),
            block_id=model.block_id,
            height_meters=model.height_meters,
            levels=model.levels,
        )
