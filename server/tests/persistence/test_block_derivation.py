from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import RoadClassification
from app.domain.road_graph import NavigableNode, Road, RoadSegment
from app.persistence.block_derivation import BlockDerivationService
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.road_graph import (
    NavigableNodeRepository,
    RoadRepository,
    RoadSegmentRepository,
)


def _build_square_block(db_session):
    """Four segments forming one closed square loop, and nothing else."""
    bbox = BoundingBox(
        min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.001, -97.799)
    )
    import_area_id = ImportAreaRepository(db_session).get_or_create("osm", bbox).id

    road = RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id="way/loop",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, -97.8), Coordinate(30.0, -97.799)),
        )
    )

    node_repo = NavigableNodeRepository(db_session)
    sw = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/sw", point=Coordinate(30.0, -97.8))
    )
    se = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/se", point=Coordinate(30.0, -97.799))
    )
    ne = node_repo.upsert(
        NavigableNode(
            id=None, import_area_id=import_area_id, source_id="node/ne", point=Coordinate(30.001, -97.799)
        )
    )
    nw = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/nw", point=Coordinate(30.001, -97.8))
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
