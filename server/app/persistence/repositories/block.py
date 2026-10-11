import uuid
from collections import defaultdict

from geoalchemy2 import Geography
from sqlalchemy import cast, exists, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.domain.block import Block
from app.domain.bounding_box import Coordinate
from app.domain.enums import ImportStatus, RoadClassification
from app.persistence.geometry import geom_to_multipolygon, geom_to_polygon, point_to_geom, polygon_to_geom
from app.persistence.models import (
    BlockBoundarySegmentModel,
    BlockModel,
    ImportAreaModel,
    RoadModel,
    RoadSegmentModel,
)


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
        return self._list(select(BlockModel).where(BlockModel.import_area_id == import_area_id))

    def ids_for_import_area(self, import_area_id: uuid.UUID) -> list[uuid.UUID]:
        """Just the ids of the area's own blocks, for the road-graph hash of a generation run."""
        return list(self.session.scalars(select(BlockModel.id).where(BlockModel.import_area_id == import_area_id)))

    def get_import_area_id(self, block_id: uuid.UUID) -> uuid.UUID | None:
        """The area a block belongs to, or None when there is no such block."""
        return self.session.scalar(select(BlockModel.import_area_id).where(BlockModel.id == block_id))

    def list_composable(self, inner_area_ids: list[uuid.UUID], outer_area_id: uuid.UUID) -> list[Block]:
        """The inner areas' whole blocks that the outer area does not hold itself.

        An inner area's clipped blocks are only the inside part of a block that straddles its
        edge, which the outer area stores whole. And an outer area imported before an inner one
        still holds every block, so a block is left out wherever an outer block covers it.

        With several levels of nesting, two inner areas can both hold the same block whole (a
        middle area imported before its own inner area). The outermost holder wins, as it does
        for features: a block is also left out where an unclipped block of another inner area
        whose bounding box covers this block's area's box covers it. Two areas with equal boxes
        cover each other, so between them the lower area id wins.
        """
        if not inner_area_ids:
            return []
        point = func.ST_PointOnSurface(BlockModel.boundary)
        outer = aliased(BlockModel)
        held_by_outer = exists().where(
            outer.import_area_id == outer_area_id,
            func.ST_Covers(outer.boundary, point),
        )
        owner, other_owner, other = aliased(ImportAreaModel), aliased(ImportAreaModel), aliased(BlockModel)
        held_by_a_more_outer_inner = exists().where(
            other.import_area_id.in_(inner_area_ids),
            other.import_area_id != BlockModel.import_area_id,
            other.is_clipped.is_(False),
            other_owner.id == other.import_area_id,
            owner.id == BlockModel.import_area_id,
            func.ST_CoveredBy(owner.bbox, other_owner.bbox),
            or_(~func.ST_Equals(owner.bbox, other_owner.bbox), other.import_area_id < BlockModel.import_area_id),
            func.ST_Covers(other.boundary, point),
        )
        return self._list(
            select(BlockModel)
            .where(
                BlockModel.import_area_id.in_(inner_area_ids),
                BlockModel.is_clipped.is_(False),
                ~held_by_outer,
                ~held_by_a_more_outer_inner,
            )
            .order_by(BlockModel.import_area_id, BlockModel.id)
        )

    def _list(self, query) -> list[Block]:
        block_models = self.session.execute(query).scalars().all()
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

    def blocks_within(
        self, point: Coordinate, meters: float, exclude_area_id: uuid.UUID | None = None
    ) -> list[tuple[Block, float]]:
        """Blocks of any completed import area whose boundary centroid is within `meters` of
        `point` (distance on the geography), nearest first with the distance in metres. Blocks of
        `exclude_area_id` are left out. Matching a block to a reference uses it to find exemplars
        in other areas."""
        centroid = cast(func.ST_Centroid(BlockModel.boundary), Geography)
        target = cast(point_to_geom(point), Geography)
        distance = func.ST_Distance(centroid, target)
        query = (
            select(BlockModel, distance)
            .join(ImportAreaModel, ImportAreaModel.id == BlockModel.import_area_id)
            .where(ImportAreaModel.status == ImportStatus.COMPLETED, func.ST_DWithin(centroid, target, meters))
            .order_by(distance, BlockModel.id)
        )
        if exclude_area_id is not None:
            query = query.where(BlockModel.import_area_id != exclude_area_id)
        rows = self.session.execute(query).all()
        if not rows:
            return []
        blocks ={block.id: block for block in self._list(select(BlockModel).where(BlockModel.id.in_([row[0].id for row in rows])))}
        return [(blocks[model.id], float(meters_away)) for model, meters_away in rows]

    def bounding_road_classes(self, block_id: uuid.UUID) -> tuple[RoadClassification, ...]:
        """The distinct classifications of the roads whose segments bound the block, for choosing
        its default fingerprint (the strongest wins: see `strongest_road_group`)."""
        rows = self.session.execute(
            select(RoadModel.classification)
            .join(RoadSegmentModel, RoadSegmentModel.road_id == RoadModel.id)
            .join(BlockBoundarySegmentModel, BlockBoundarySegmentModel.road_segment_id == RoadSegmentModel.id)
            .where(BlockBoundarySegmentModel.block_id == block_id)
            .distinct()
        ).scalars().all()
        return tuple(RoadClassification(row) for row in rows)

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
