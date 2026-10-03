import uuid

from app.domain.bounding_box import Coordinate
from app.domain.enums import MovementKind, RestrictionKind
from app.domain.road_graph import RoadSegment
from app.domain.turn_movement import turn_candidates

CENTER = Coordinate(30.0, -97.8)
WEST = Coordinate(30.0, -97.801)
EAST = Coordinate(30.0, -97.799)
NORTH = Coordinate(30.001, -97.8)
SOUTH = Coordinate(29.999, -97.8)


def _segment(start, end):
    return RoadSegment(id=uuid.uuid4(), road_id=uuid.uuid4(), from_node_id=uuid.uuid4(), to_node_id=uuid.uuid4(), geom=(start, end))


def test_every_incoming_outgoing_pair_is_a_default_allowed_candidate():
    node_id = uuid.uuid4()
    from_west, from_south = _segment(WEST, CENTER), _segment(SOUTH, CENTER)
    to_east, to_north = _segment(CENTER, EAST), _segment(CENTER, NORTH)

    candidates = turn_candidates(node_id, [from_west, from_south], [to_east, to_north])

    assert {(c.incoming_segment_id, c.outgoing_segment_id) for c in candidates} == {
        (i.id, o.id) for i in (from_west, from_south) for o in (to_east, to_north)
    }
    assert len(candidates) == 4
    assert all(c.id is None and c.intersection_node_id == node_id for c in candidates)
    assert all(c.allowed and c.restriction_kind == RestrictionKind.NONE for c in candidates)


def test_straight_left_and_right_are_classified_from_the_bearings():
    from_west, from_south = _segment(WEST, CENTER), _segment(SOUTH, CENTER)
    to_east, to_north = _segment(CENTER, EAST), _segment(CENTER, NORTH)

    candidates = turn_candidates(uuid.uuid4(), [from_west, from_south], [to_east, to_north])

    kinds = {(c.incoming_segment_id, c.outgoing_segment_id): c.movement_kind for c in candidates}
    assert kinds[(from_west.id, to_east.id)] == MovementKind.STRAIGHT
    assert kinds[(from_south.id, to_north.id)] == MovementKind.STRAIGHT
    assert kinds[(from_west.id, to_north.id)] == MovementKind.LEFT
    assert kinds[(from_south.id, to_east.id)] == MovementKind.RIGHT


def test_a_node_with_no_incoming_or_no_outgoing_segments_has_no_candidates():
    assert turn_candidates(uuid.uuid4(), [], [_segment(CENTER, EAST)]) == []
    assert turn_candidates(uuid.uuid4(), [_segment(WEST, CENTER)], []) == []
