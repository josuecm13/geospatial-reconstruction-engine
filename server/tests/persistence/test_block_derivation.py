from sqlalchemy import select

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.building import Building
from app.domain.enums import BuildingCategory, RoadClassification
from app.domain.road_graph import NavigableNode, Road, RoadSegment
from app.persistence.block_derivation import BlockDerivationService
from app.persistence.models import BlockModel
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.road_graph import (
    NavigableNodeRepository,
    RoadRepository,
    RoadSegmentRepository,
)


def _block_ids_for_area(db_session, import_area_id) -> set:
    return set(
        db_session.execute(select(BlockModel.id).where(BlockModel.import_area_id == import_area_id)).scalars().all()
    )


def _build_square_block(db_session, *, lon_offset: float = 0.0, source_prefix: str = "loop"):
    """Four segments forming one closed square loop, and nothing else."""
    base_lon = -97.8 + lon_offset
    bbox = BoundingBox(
        min_corner=Coordinate(30.0, base_lon), max_corner=Coordinate(30.001, base_lon + 0.001)
    )
    import_area_id = ImportAreaRepository(db_session).get_or_create("osm", bbox).id

    road = RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id=f"way/{source_prefix}",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, base_lon), Coordinate(30.0, base_lon + 0.001)),
        )
    )

    node_repo = NavigableNodeRepository(db_session)
    sw = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id=f"node/{source_prefix}/sw", point=Coordinate(30.0, base_lon))
    )
    se = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id=f"node/{source_prefix}/se", point=Coordinate(30.0, base_lon + 0.001))
    )
    ne = node_repo.upsert(
        NavigableNode(
            id=None, import_area_id=import_area_id, source_id=f"node/{source_prefix}/ne", point=Coordinate(30.001, base_lon + 0.001)
        )
    )
    nw = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id=f"node/{source_prefix}/nw", point=Coordinate(30.001, base_lon))
    )

    segment_repo = RoadSegmentRepository(db_session)
    segments = [
        segment_repo.upsert(
            RoadSegment(id=None, road_id=road.id, from_node_id=sw.id, to_node_id=se.id, geom=(sw.point, se.point))
        ),
        segment_repo.upsert(
            RoadSegment(id=None, road_id=road.id, from_node_id=se.id, to_node_id=ne.id, geom=(se.point, ne.point))
        ),
        segment_repo.upsert(
            RoadSegment(id=None, road_id=road.id, from_node_id=ne.id, to_node_id=nw.id, geom=(ne.point, nw.point))
        ),
        segment_repo.upsert(
            RoadSegment(id=None, road_id=road.id, from_node_id=nw.id, to_node_id=sw.id, geom=(nw.point, sw.point))
        ),
    ]
    db_session.flush()
    return import_area_id, {s.id for s in segments}


def _add_building_inside(db_session, import_area_id, *, source_id="building/inside", lon_offset: float = 0.0):
    base_lon = -97.8 + lon_offset
    corners = (
        Coordinate(30.0003, base_lon + 0.0003),
        Coordinate(30.0003, base_lon + 0.0007),
        Coordinate(30.0007, base_lon + 0.0007),
        Coordinate(30.0007, base_lon + 0.0003),
        Coordinate(30.0003, base_lon + 0.0003),
    )
    return BuildingRepository(db_session).upsert(
        Building(id=None, import_area_id=import_area_id, source_id=source_id, category=BuildingCategory.RESIDENTIAL, geom=corners)
    )


def test_closed_loop_produces_exactly_one_block(db_session):
    import_area_id, segment_ids = _build_square_block(db_session)

    blocks = BlockDerivationService(db_session).derive_for_import_area(import_area_id)

    assert len(blocks) == 1
    assert blocks[0].area_square_meters > 0


def test_block_boundary_segments_match_the_loop(db_session):
    import_area_id, segment_ids = _build_square_block(db_session)

    blocks = BlockDerivationService(db_session).derive_for_import_area(import_area_id)

    assert set(blocks[0].bounding_segment_ids) == segment_ids
    assert len(blocks[0].bounding_segment_ids) == 4


def test_boundary_segments_are_recorded_in_a_readable_order(db_session):
    import_area_id, segment_ids = _build_square_block(db_session)
    from app.persistence.repositories.block import BlockRepository

    blocks = BlockDerivationService(db_session).derive_for_import_area(import_area_id)
    ordered_ids = BlockRepository(db_session).get_boundary_segment_ids(blocks[0].id)

    assert list(ordered_ids) == list(blocks[0].bounding_segment_ids)
    assert set(ordered_ids) == segment_ids


def test_rederive_replaces_blocks_and_relinks_buildings(db_session):
    import_area_id, _ = _build_square_block(db_session)
    building = _add_building_inside(db_session, import_area_id)

    blocks_first, linked_first = BlockDerivationService(db_session).rederive_for_import_area(import_area_id)
    building_after_first = BuildingRepository(db_session).get(building.id)

    assert len(blocks_first) == 1
    assert linked_first == 1
    assert building_after_first.block_id == blocks_first[0].id

    blocks_second, linked_second = BlockDerivationService(db_session).rederive_for_import_area(import_area_id)
    building_after_second = BuildingRepository(db_session).get(building.id)

    # Re-deriving replaces, so the area still has exactly one current block —
    # not two — and the building is linked to that current one.
    assert len(blocks_second) == 1
    assert linked_second == 1
    assert building_after_second.block_id == blocks_second[0].id


def test_rederive_leaves_another_import_area_untouched(db_session):
    area_one, _ = _build_square_block(db_session, lon_offset=0.0, source_prefix="one")
    building_one = _add_building_inside(db_session, area_one, source_id="building/one", lon_offset=0.0)
    area_two, _ = _build_square_block(db_session, lon_offset=1.0, source_prefix="two")
    building_two = _add_building_inside(db_session, area_two, source_id="building/two", lon_offset=1.0)

    BlockDerivationService(db_session).rederive_for_import_area(area_one)
    blocks_two_before, _ = BlockDerivationService(db_session).rederive_for_import_area(area_two)
    building_two_link_before = BuildingRepository(db_session).get(building_two.id).block_id

    # Re-deriving area_one again must not disturb area_two's blocks or links.
    BlockDerivationService(db_session).rederive_for_import_area(area_one)

    blocks_two_after = _block_ids_for_area(db_session, area_two)
    building_two_link_after = BuildingRepository(db_session).get(building_two.id).block_id
    building_one_link_after = BuildingRepository(db_session).get(building_one.id).block_id

    assert blocks_two_after == {blocks_two_before[0].id}
    assert building_two_link_after == building_two_link_before
    assert building_one_link_after is not None
