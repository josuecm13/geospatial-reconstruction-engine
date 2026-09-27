import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.block import Block
from app.persistence.geometry import geom_to_multipolygon, geom_to_polygon, polygon_to_geom
from app.persistence.models import BlockBoundarySegmentModel, BlockModel


class BlockRepository:
    def __init__(self, session: Session):
        self.session = session

    def add(self, block: Block) -> Block:
        model = BlockModel(
            import_area_id=block.import_area_id,
            boundary=polygon_to_geom(block.boundary),
            area_square_meters=block.area_square_meters,
        )
        self.session.add(model)
        self.session.flush()

        for order, segment_id in enumerate(block.bounding_segment_ids):
            self.session.add(
                BlockBoundarySegmentModel(
                    block_id=model.id,
                    road_segment_id=segment_id,
                    sequence_order=order,
                )
            )
        self.session.flush()

        return self._to_domain(model, block.bounding_segment_ids)

    def list_for_import_area(self, import_area_id: uuid.UUID) -> list[Block]:
        block_models = self.session.execute(
            select(BlockModel).where(BlockModel.import_area_id == import_area_id)
        ).scalars().all()
        block_ids = [model.id for model in block_models]

        # One extra query for every block's boundary segments, not one per block.
        boundary_rows = self.session.execute(
            select(BlockBoundarySegmentModel.block_id, BlockBoundarySegmentModel.road_segment_id)
            .where(BlockBoundarySegmentModel.block_id.in_(block_ids))
            .order_by(BlockBoundarySegmentModel.block_id, BlockBoundarySegmentModel.sequence_order)
        ).all()
        boundaries: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
        for block_id, segment_id in boundary_rows:
            boundaries[block_id].append(segment_id)

        return [self._to_domain(model, tuple(boundaries.get(model.id, ()))) for model in block_models]

    def get_boundary_segment_ids(self, block_id: uuid.UUID) -> tuple[uuid.UUID, ...]:
        rows = self.session.execute(
            select(BlockBoundarySegmentModel.road_segment_id)
            .where(BlockBoundarySegmentModel.block_id == block_id)
            .order_by(BlockBoundarySegmentModel.sequence_order)
        ).scalars().all()
        return tuple(rows)

    @staticmethod
    def _to_domain(model: BlockModel, bounding_segment_ids: tuple[uuid.UUID, ...]) -> Block:
        return Block(
            id=model.id,
            import_area_id=model.import_area_id,
            boundary=geom_to_polygon(model.boundary),
            area_square_meters=model.area_square_meters,
            bounding_segment_ids=tuple(bounding_segment_ids),
            buildable_area=geom_to_multipolygon(model.buildable_area) if model.buildable_area is not None else None,
            buildable_area_square_meters=model.buildable_area_square_meters,
            is_median=model.is_median,
            is_clipped=model.is_clipped,
        )
