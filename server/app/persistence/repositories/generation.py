import uuid
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.domain.generation import (
    BlockFeedback,
    CountSource,
    Fingerprint,
    GeneratedBuilding,
    GenerationRun,
    GenerationZone,
    NewGenerationRun,
    SettlementStyle,
    StoredBlockFeedback,
    ZoneReason,
    fingerprint_from_dict,
    fingerprint_to_dict,
)
from app.persistence.geometry import geom_to_multipolygon, geom_to_polygon, multipolygon_to_geom, polygon_to_geom
from app.persistence.models import (
    BlockFeedbackModel,
    BlockFingerprintModel,
    BlockModel,
    GeneratedBuildingModel,
    GenerationRunModel,
    GenerationZoneModel,
)


class GenerationRepository:
    """An area's current generation run and what it produced. Generation never touches an observed
    table. The caller commits."""

    def __init__(self, session: Session):
        self.session = session

    def replace(
        self,
        run: NewGenerationRun,
        buildings: Iterable[GeneratedBuilding],
        zones: Iterable[GenerationZone],
        fingerprints: Mapping[uuid.UUID, Fingerprint],
    ) -> GenerationRun:
        """Makes `run` the area's only run, in the caller's transaction: the old run is deleted (its
        buildings, zones and fingerprints go with it through the cascades) and the new one inserted."""
        self.delete(run.import_area_id)
        model = GenerationRunModel(
            id=run.id,
            import_area_id=run.import_area_id,
            seed=run.seed,
            algorithm_version=run.algorithm_version,
            parameters=dict(run.parameters),
            elevation_version=run.elevation_version,
            road_graph_hash=run.road_graph_hash,
            building_count=run.building_count,
            block_count=run.block_count,
        )
        self.session.add(model)
        self.session.flush()

        building_models = [
            GeneratedBuildingModel(
                id=building.id,
                run_id=model.id,
                block_id=building.block_id,
                geom=polygon_to_geom(building.geom),
                height_meters=building.height_meters,
                levels=building.levels,
                base_elevation_meters=building.base_elevation_meters,
                style=building.style.value,
                reference_block_id=building.reference_block_id,
                count_source=building.count_source.value,
            )
            for building in buildings
        ]
        zone_models = [
            GenerationZoneModel(
                run_id=model.id, block_id=zone.block_id, reason=zone.reason.value, geom=multipolygon_to_geom(zone.geom)
            )
            for zone in zones
        ]
        fingerprint_models = [
            BlockFingerprintModel(run_id=model.id, block_id=block_id, fingerprint=fingerprint_to_dict(value))
            for block_id, value in fingerprints.items()
        ]
        self.session.add_all([*building_models, *zone_models, *fingerprint_models])
        self.session.flush()
        return self._run_to_domain(model)

    def get_run(self, import_area_id: uuid.UUID) -> GenerationRun | None:
        model = self.session.execute(
            select(GenerationRunModel).where(GenerationRunModel.import_area_id == import_area_id)
        ).scalar_one_or_none()
        return self._run_to_domain(model) if model is not None else None

    def delete(self, import_area_id: uuid.UUID) -> bool:
        """Deletes the area's run; its buildings, zones and fingerprints go with it."""
        result = self.session.execute(
            delete(GenerationRunModel).where(GenerationRunModel.import_area_id == import_area_id)
        )
        # A bulk delete leaves the loaded rows in the identity map; drop them so a later read is fresh.
        self.session.expire_all()
        return result.rowcount > 0

    def list_buildings(self, owner_area_ids: Sequence[uuid.UUID]) -> list[GeneratedBuilding]:
        """The generated buildings of the runs of `owner_area_ids`, in owner order and then by id,
        each with the area whose run placed it."""
        buildings: list[GeneratedBuilding] = []
        for owner_id in owner_area_ids:
            rows = self.session.execute(
                select(GeneratedBuildingModel)
                .join(GenerationRunModel, GenerationRunModel.id == GeneratedBuildingModel.run_id)
                .where(GenerationRunModel.import_area_id == owner_id)
                .order_by(GeneratedBuildingModel.id)
            ).scalars()
            buildings.extend(self._building_to_domain(model, owner_id) for model in rows)
        return buildings

    def generated_counts(self, run_id: uuid.UUID) -> dict[uuid.UUID, int]:
        """Block id -> how many buildings the run generated on it (blocks with none are absent)."""
        rows = self.session.execute(
            select(GeneratedBuildingModel.block_id, func.count())
            .where(GeneratedBuildingModel.run_id == run_id)
            .group_by(GeneratedBuildingModel.block_id)
        ).all()
        return {block_id: count for block_id, count in rows}

    def list_zones(self, import_area_id: uuid.UUID) -> list[GenerationZone]:
        rows = self.session.execute(
            select(GenerationZoneModel)
            .join(GenerationRunModel, GenerationRunModel.id == GenerationZoneModel.run_id)
            .where(GenerationRunModel.import_area_id == import_area_id)
            .order_by(GenerationZoneModel.block_id, GenerationZoneModel.reason, GenerationZoneModel.id)
        ).scalars()
        return [
            GenerationZone(
                id=model.id,
                run_id=model.run_id,
                block_id=model.block_id,
                reason=ZoneReason(model.reason),
                geom=geom_to_multipolygon(model.geom),
            )
            for model in rows
        ]

    def fingerprints(self, run_id: uuid.UUID) -> dict[uuid.UUID, Fingerprint]:
        rows = self.session.execute(
            select(BlockFingerprintModel.block_id, BlockFingerprintModel.fingerprint).where(
                BlockFingerprintModel.run_id == run_id
            )
        ).all()
        return {block_id: fingerprint_from_dict(data) for block_id, data in rows}

    @staticmethod
    def _run_to_domain(model: GenerationRunModel) -> GenerationRun:
        return GenerationRun(
            id=model.id,
            import_area_id=model.import_area_id,
            seed=model.seed,
            algorithm_version=model.algorithm_version,
            parameters=dict(model.parameters),
            elevation_version=model.elevation_version,
            road_graph_hash=model.road_graph_hash,
            building_count=model.building_count,
            block_count=model.block_count,
            created_at=model.created_at,
        )

    @staticmethod
    def _building_to_domain(model: GeneratedBuildingModel, import_area_id: uuid.UUID) -> GeneratedBuilding:
        return GeneratedBuilding(
            id=model.id,
            run_id=model.run_id,
            block_id=model.block_id,
            geom=geom_to_polygon(model.geom),
            height_meters=model.height_meters,
            levels=model.levels,
            base_elevation_meters=model.base_elevation_meters,
            style=SettlementStyle(model.style),
            reference_block_id=model.reference_block_id,
            count_source=CountSource(model.count_source),
            import_area_id=import_area_id,
        )


class BlockFeedbackRepository:
    """People's corrections of how many buildings a block holds. The caller commits."""

    def __init__(self, session: Session):
        self.session = session

    def put(self, feedback: BlockFeedback) -> BlockFeedback:
        """Stores the feedback, replacing any the block already had."""
        model = self.session.get(BlockFeedbackModel, feedback.block_id)
        if model is None:
            model = BlockFeedbackModel(block_id=feedback.block_id)
            self.session.add(model)
        model.import_area_id = feedback.import_area_id
        model.building_count = feedback.building_count
        model.no_buildings = feedback.no_buildings
        # Set here, not left to onupdate, so a replace always moves it.
        model.updated_at = func.now()
        self.session.flush()
        self.session.refresh(model)
        return self._to_domain(model)

    def get(self, block_id: uuid.UUID) -> BlockFeedback | None:
        model = self.session.get(BlockFeedbackModel, block_id)
        return self._to_domain(model) if model is not None else None

    def delete(self, block_id: uuid.UUID) -> bool:
        result = self.session.execute(delete(BlockFeedbackModel).where(BlockFeedbackModel.block_id == block_id))
        self.session.expire_all()
        return result.rowcount > 0

    def list_for_import_area(self, import_area_id: uuid.UUID) -> list[StoredBlockFeedback]:
        """The area's feedback ordered by block id, each flagged `orphaned` when its block no longer
        exists in `blocks`."""
        exists = select(BlockModel.id).where(BlockModel.id == BlockFeedbackModel.block_id).exists()
        rows = self.session.execute(
            select(BlockFeedbackModel, exists)
            .where(BlockFeedbackModel.import_area_id == import_area_id)
            .order_by(BlockFeedbackModel.block_id)
        ).all()
        return [StoredBlockFeedback(self._to_domain(model), orphaned=not block_exists) for model, block_exists in rows]

    @staticmethod
    def _to_domain(model: BlockFeedbackModel) -> BlockFeedback:
        return BlockFeedback(
            block_id=model.block_id,
            import_area_id=model.import_area_id,
            building_count=model.building_count,
            no_buildings=model.no_buildings,
            updated_at=model.updated_at,
        )
