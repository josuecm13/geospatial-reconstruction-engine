from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.covered_areas import compose_by_source_id, is_covered_by, is_covered_by_any, without_covered

INNER = BoundingBox(Coordinate(10.0, 20.0), Coordinate(10.001, 20.001))
OTHER = BoundingBox(Coordinate(10.002, 20.002), Coordinate(10.003, 20.003))


def _square(lat: float, lon: float, size: float = 0.0002) -> tuple[Coordinate, ...]:
    return (
        Coordinate(lat, lon),
        Coordinate(lat, lon + size),
        Coordinate(lat + size, lon + size),
        Coordinate(lat + size, lon),
        Coordinate(lat, lon),
    )


def test_a_polygon_inside_the_box_is_covered():
    assert is_covered_by(_square(10.0004, 20.0004), INNER)


def test_a_polygon_crossing_the_box_edge_is_not_covered():
    assert not is_covered_by(_square(10.0009, 20.0004), INNER)


def test_a_polygon_outside_the_box_is_not_covered():
    assert not is_covered_by(_square(10.0015, 20.0004), INNER)


def test_the_edge_counts_as_covered():
    assert is_covered_by((Coordinate(10.0, 20.0), Coordinate(10.001, 20.001)), INNER)


def test_no_points_cover_nothing():
    assert not is_covered_by((), INNER)


def test_any_of_several_boxes_covers():
    assert is_covered_by_any(_square(10.0022, 20.0022), [INNER, OTHER])
    assert not is_covered_by_any(_square(10.0012, 20.0012), [INNER, OTHER])
    assert not is_covered_by_any(_square(10.0004, 20.0004), [])


def test_without_covered_keeps_order_and_splits_off_the_covered():
    features = {
        "outside": _square(10.0015, 20.0004),
        "inside": _square(10.0004, 20.0004),
        "straddling": _square(10.0009, 20.0004),
        "in_other": _square(10.0022, 20.0022),
    }

    kept, covered = without_covered(list(features), lambda name: features[name], [INNER, OTHER])

    assert kept == ["outside", "straddling"]
    assert covered == ["inside", "in_other"]


def test_without_covered_with_no_boxes_keeps_everything():
    kept, covered = without_covered(["a", "b"], lambda name: (Coordinate(10.0005, 20.0005),), [])

    assert kept == ["a", "b"]
    assert covered == []


def test_compose_keeps_the_first_copy_of_each_source_id():
    own = [("1", "outer"), ("2", "outer")]
    inner = [("2", "inner"), ("3", "inner")]
    other_inner = [("3", "other"), ("4", "other")]

    composed = compose_by_source_id([own, inner, other_inner], lambda item: item[0])

    assert composed == [("1", "outer"), ("2", "outer"), ("3", "inner"), ("4", "other")]
