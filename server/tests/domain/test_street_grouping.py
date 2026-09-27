import uuid

from app.domain.bounding_box import Coordinate
from app.domain.enums import RoadClassification
from app.domain.street_grouping import GroupableWay, group_ways_into_streets, normalize_street_name, street_id_for

RESIDENTIAL = RoadClassification.RESIDENTIAL


def _way(source_id, name, nodes, points, one_way=0, classification=RESIDENTIAL):
    return GroupableWay(source_id, name, classification, tuple(nodes), tuple(Coordinate(*p) for p in points), one_way)


def _keys(ways):
    return {group.key for group in group_ways_into_streets(ways)}


def test_connected_ways_with_the_same_normalized_name_form_one_street():
    ways = [
        _way("1", "Main Street", ["a", "b"], [(0.0, 0.0), (0.0, 0.001)]),
        _way("2", "  main   STREET ", ["b", "c"], [(0.0, 0.001), (0.0, 0.002)]),
    ]

    assert _keys(ways) == {"1+2"}


def test_same_name_without_connection_stays_separate():
    ways = [
        _way("1", "Main Street", ["a", "b"], [(0.0, 0.0), (0.0, 0.001)]),
        _way("2", "Main Street", ["c", "d"], [(0.01, 0.0), (0.01, 0.001)]),
    ]

    assert _keys(ways) == {"1", "2"}


def test_connected_unnamed_ways_stay_separate():
    ways = [
        _way("1", None, ["a", "b"], [(0.0, 0.0), (0.0, 0.001)]),
        _way("2", " ", ["b", "c"], [(0.0, 0.001), (0.0, 0.002)]),
    ]

    assert _keys(ways) == {"1", "2"}


def test_divided_road_carriageways_form_one_street():
    # Opposite one-way carriageways ~17 m apart; the second is digitized
    # eastward but one-way against its nodes, so it travels west.
    east = _way("1", "Central Avenue", ["a", "b"], [(0.0, 0.0), (0.0, 0.001)], one_way=1)
    west = _way("2", "Central Avenue", ["c", "d"], [(0.00015, 0.0), (0.00015, 0.001)], one_way=-1)

    assert _keys([east, west]) == {"1+2"}


def test_same_direction_one_way_neighbours_stay_separate():
    first = _way("1", "Central Avenue", ["a", "b"], [(0.0, 0.0), (0.0, 0.001)], one_way=1)
    second = _way("2", "Central Avenue", ["c", "d"], [(0.00015, 0.0), (0.00015, 0.001)], one_way=1)

    assert _keys([first, second]) == {"1", "2"}


def test_opposite_carriageways_too_far_apart_stay_separate():
    east = _way("1", "Central Avenue", ["a", "b"], [(0.0, 0.0), (0.0, 0.001)], one_way=1)
    west = _way("2", "Central Avenue", ["c", "d"], [(0.001, 0.001), (0.001, 0.0)], one_way=1)  # ~111 m

    assert _keys([east, west]) == {"1", "2"}


def test_group_reports_its_most_significant_classification():
    ways = [
        _way("1", "Main Street", ["a", "b"], [(0.0, 0.0), (0.0, 0.001)], classification=RoadClassification.RESIDENTIAL),
        _way("2", "Main Street", ["b", "c"], [(0.0, 0.001), (0.0, 0.002)], classification=RoadClassification.SECONDARY),
    ]

    (group,) = group_ways_into_streets(ways)

    assert group.classification is RoadClassification.SECONDARY


def test_street_id_is_deterministic_per_area_and_group():
    area = uuid.uuid4()

    assert street_id_for(area, "1+2") == street_id_for(area, "1+2")
    assert street_id_for(area, "1+2") != street_id_for(area, "1")
    assert street_id_for(area, "1+2") != street_id_for(uuid.uuid4(), "1+2")


def test_name_normalization():
    assert normalize_street_name("  Main\tStreet ") == "main street"
    assert normalize_street_name("   ") is None
    assert normalize_street_name(None) is None
