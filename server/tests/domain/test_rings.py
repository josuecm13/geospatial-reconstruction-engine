import math

from app.domain.bounding_box import Coordinate
from app.domain.rings import mean_vertex, ring_batches

CENTER = Coordinate(latitude=0.0, longitude=0.0)
# At the equator one degree of latitude or longitude is about 111,195 m.
METERS_PER_DEGREE = math.pi * 6_371_000.0 / 180


def _east(meters: float) -> Coordinate:
    return Coordinate(latitude=0.0, longitude=meters / METERS_PER_DEGREE)


def _positions(named: dict[str, Coordinate]):
    return lambda name: named[name]


def test_items_are_grouped_by_ring_nearest_first():
    named = {"far": _east(250), "near": _east(10), "mid": _east(120), "mid2": _east(180)}

    batches = ring_batches(list(named), CENTER, _positions(named))

    assert batches == [["near"], ["mid", "mid2"], ["far"]]


def test_every_item_appears_exactly_once():
    named = {f"b{i}": _east(i * 17) for i in range(40)}

    batches = ring_batches(list(named), CENTER, _positions(named))

    flat = [name for batch in batches for name in batch]
    assert sorted(flat) == sorted(named)


def test_empty_rings_are_skipped():
    named = {"a": _east(10), "b": _east(510)}

    assert ring_batches(list(named), CENTER, _positions(named)) == [["a"], ["b"]]


def test_no_items_gives_no_rings():
    assert ring_batches([], CENTER, lambda item: CENTER) == []


def test_ring_width_is_configurable():
    named = {"a": _east(10), "b": _east(60)}

    assert ring_batches(list(named), CENTER, _positions(named), ring_width_meters=50.0) == [["a"], ["b"]]


def test_ties_are_broken_by_the_tie_break_key_whatever_the_input_order():
    named = {"a": _east(40), "b": _east(40), "c": _east(40)}

    forward = ring_batches(["c", "a", "b"], CENTER, _positions(named), tie_break=lambda name: name)
    backward = ring_batches(["b", "c", "a"], CENTER, _positions(named), tie_break=lambda name: name)

    assert forward == backward == [["a", "b", "c"]]


def test_mean_vertex_counts_a_closing_duplicate_once():
    square = (Coordinate(0, 0), Coordinate(0, 2), Coordinate(2, 2), Coordinate(2, 0), Coordinate(0, 0))

    assert mean_vertex(square) == Coordinate(latitude=1.0, longitude=1.0)
