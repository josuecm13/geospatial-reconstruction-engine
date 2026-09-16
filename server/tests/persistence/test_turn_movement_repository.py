import pytest
from sqlalchemy.exc import DBAPIError

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import MovementKind, RestrictionKind
from app.domain.road_graph import NavigableNode, Road, RoadSegment
from app.domain.enums import RoadClassification
from app.domain.turn_movement import TurnMovement
from app.persistence.models import TurnMovementModel
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.road_graph import (
    NavigableNodeRepository,
    RoadRepository,
    RoadSegmentRepository,
)
from app.persistence.repositories.turn_movement import TurnMovementRepository


def _build_four_way_intersection(db_session):
    """center N, incoming from west (A) and south (E), outgoing east (B) and north (D)."""
    bbox = BoundingBox(
        min_corner=Coordinate(29.999, -97.801), max_corner=Coordinate(30.001, -97.799)
    )
    import_area_id = ImportAreaRepository(db_session).get_or_create("osm", bbox).id

    road = RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id="way/intersection",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, -97.801), Coordinate(30.0, -97.799)),
        )
    )

    node_repo = NavigableNodeRepository(db_session)
    n = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/N", point=Coordinate(30.0, -97.8))
    )
    a = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/A", point=Coordinate(30.0, -97.801))
    )
    b = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/B", point=Coordinate(30.0, -97.799))
    )
    d = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/D", point=Coordinate(30.001, -97.8))
    )
    e = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/E", point=Coordinate(29.999, -97.8))
    )

    segment_repo = RoadSegmentRepository(db_session)
    a_to_n = segment_repo.upsert(
        RoadSegment(id=None, road_id=road.id, from_node_id=a.id, to_node_id=n.id, geom=(a.point, n.point))
    )
    e_to_n = segment_repo.upsert(
        RoadSegment(id=None, road_id=road.id, from_node_id=e.id, to_node_id=n.id, geom=(e.point, n.point))
    )
    n_to_b = segment_repo.upsert(
        RoadSegment(id=None, road_id=road.id, from_node_id=n.id, to_node_id=b.id, geom=(n.point, b.point))
    )
    n_to_d = segment_repo.upsert(
        RoadSegment(id=None, road_id=road.id, from_node_id=n.id, to_node_id=d.id, geom=(n.point, d.point))
    )

    return {
        "intersection_node_id": n.id,
        "a_to_n": a_to_n,
        "e_to_n": e_to_n,
        "n_to_b": n_to_b,
        "n_to_d": n_to_d,
    }


def test_dense_candidate_generation_covers_every_pair(db_session):
    fixture = _build_four_way_intersection(db_session)
    repo = TurnMovementRepository(db_session)

    candidates = repo.generate_candidates(fixture["intersection_node_id"])

    assert len(candidates) == 4  # 2 incoming x 2 outgoing
    pairs = {(c.incoming_segment_id, c.outgoing_segment_id) for c in candidates}
    assert (fixture["a_to_n"].id, fixture["n_to_b"].id) in pairs
    assert (fixture["a_to_n"].id, fixture["n_to_d"].id) in pairs
    assert (fixture["e_to_n"].id, fixture["n_to_b"].id) in pairs
    assert (fixture["e_to_n"].id, fixture["n_to_d"].id) in pairs


def test_candidates_default_to_allowed_with_no_restriction(db_session):
    fixture = _build_four_way_intersection(db_session)
    repo = TurnMovementRepository(db_session)

    candidates = repo.generate_candidates(fixture["intersection_node_id"])
    persisted = repo.persist_candidates(candidates)

    assert all(m.allowed for m in persisted)
    assert all(m.restriction_kind == RestrictionKind.NONE for m in persisted)


def test_classification_distinguishes_straight_left_and_right(db_session):
    fixture = _build_four_way_intersection(db_session)
    repo = TurnMovementRepository(db_session)
    candidates = repo.generate_candidates(fixture["intersection_node_id"])

    by_pair = {(c.incoming_segment_id, c.outgoing_segment_id): c.movement_kind for c in candidates}

    assert by_pair[(fixture["a_to_n"].id, fixture["n_to_b"].id)] == MovementKind.STRAIGHT
    assert by_pair[(fixture["e_to_n"].id, fixture["n_to_d"].id)] == MovementKind.STRAIGHT
    assert by_pair[(fixture["a_to_n"].id, fixture["n_to_d"].id)] == MovementKind.LEFT
    assert by_pair[(fixture["e_to_n"].id, fixture["n_to_b"].id)] == MovementKind.RIGHT


def test_explicit_restriction_marks_movement_not_allowed(db_session):
    fixture = _build_four_way_intersection(db_session)
    repo = TurnMovementRepository(db_session)
    candidates = repo.generate_candidates(fixture["intersection_node_id"])

    for candidate in candidates:
        if (
            candidate.incoming_segment_id == fixture["a_to_n"].id
            and candidate.outgoing_segment_id == fixture["n_to_d"].id
        ):
            candidates[candidates.index(candidate)] = TurnMovement(
                id=candidate.id,
                intersection_node_id=candidate.intersection_node_id,
                incoming_segment_id=candidate.incoming_segment_id,
                outgoing_segment_id=candidate.outgoing_segment_id,
                movement_kind=candidate.movement_kind,
                allowed=False,
                restriction_kind=RestrictionKind.NO_LEFT_TURN,
            )

    persisted = repo.persist_candidates(candidates)
    restricted = next(
        m
        for m in persisted
        if m.incoming_segment_id == fixture["a_to_n"].id and m.outgoing_segment_id == fixture["n_to_d"].id
    )

    assert restricted.allowed is False
    assert restricted.restriction_kind == RestrictionKind.NO_LEFT_TURN


def test_trigger_rejects_incoming_segment_not_ending_at_intersection(db_session):
    fixture = _build_four_way_intersection(db_session)

    bad_movement = TurnMovementModel(
        intersection_node_id=fixture["intersection_node_id"],
        incoming_segment_id=fixture["n_to_b"].id,  # ends at B, not N
        outgoing_segment_id=fixture["n_to_d"].id,
        movement_kind=MovementKind.STRAIGHT.value,
        allowed=True,
        restriction_kind=RestrictionKind.NONE.value,
    )
    db_session.add(bad_movement)

    with pytest.raises(DBAPIError):
        db_session.flush()
