import json
from pathlib import Path

import pytest

from app.domain.enums import BuildingCategory, PoiCategory, RestrictionKind, RoadClassification
from app.ingestion.osm_adapter import OSMFixtureAdapter, OSMIngestionError


FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"


def test_adapter_translates_supported_features_and_ignores_unsupported_feature():
    records = OSMFixtureAdapter().parse(json.loads(FIXTURE.read_text()))

    assert len(records.roads) == 3
    assert records.roads[0].forward_lanes == 2
    assert records.roads[0].backward_lanes == 1
    assert records.roads[1].forward_lanes is None
    assert records.buildings[0].category is BuildingCategory.RESIDENTIAL
    assert records.pois[0].category is PoiCategory.EDUCATION
    assert records.restrictions[0].kind is RestrictionKind.NO_LEFT_TURN


def test_adapter_rejects_supported_road_with_missing_node_reference():
    payload = {"elements": [{"type": "way", "id": 1, "nodes": [10, 20], "tags": {"highway": "residential"}}]}

    with pytest.raises(OSMIngestionError, match="missing node"):
        OSMFixtureAdapter().parse(payload)


def test_adapter_preserves_reverse_one_way_and_unknown_lanes():
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.079},
            {"type": "way", "id": 10, "nodes": [1, 2], "tags": {"highway": "residential", "oneway": "-1", "lanes": "unknown"}},
        ]
    }

    road = OSMFixtureAdapter().parse(payload).roads[0]

    assert road.one_way_direction == -1
    assert road.forward_lanes is None
    assert road.backward_lanes is None


def test_adapter_rejects_malformed_supported_polygon():
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.079},
            {"type": "way", "id": 10, "nodes": [1, 2, 1, 1], "tags": {"building": "yes"}},
        ]
    }

    with pytest.raises(OSMIngestionError, match="three distinct"):
        OSMFixtureAdapter().parse(payload)


def test_adapter_translates_supported_poi_area_to_representative_point():
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.079},
            {"type": "node", "id": 3, "lat": 9.935, "lon": -84.079},
            {"type": "way", "id": 10, "nodes": [1, 2, 3, 1], "tags": {"amenity": "cafe", "name": "Corner Cafe"}},
        ]
    }

    poi = OSMFixtureAdapter().parse(payload).pois[0]

    assert poi.category is PoiCategory.FOOD_AND_DRINK
    assert poi.name == "Corner Cafe"
    assert poi.point.latitude == pytest.approx(9.934333333333333)


def _road_way(tags: dict) -> dict:
    return {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.079},
            {"type": "way", "id": 10, "nodes": [1, 2], "tags": tags},
        ]
    }


@pytest.mark.parametrize(
    ("tags", "expected_forward", "expected_backward"),
    [
        ({"highway": "residential", "lanes": "2"}, 1, 1),
        ({"highway": "primary", "lanes": "4"}, 2, 2),
        ({"highway": "primary", "lanes": "3"}, 2, 1),
        ({"highway": "residential", "lanes": "1"}, 1, None),
        ({"highway": "primary", "lanes": "3", "lanes:forward": "2"}, 2, 1),
        ({"highway": "primary", "lanes:forward": "2", "lanes:backward": "1"}, 2, 1),
        ({"highway": "residential"}, None, None),
    ],
)
def test_adapter_splits_bidirectional_lane_totals(tags, expected_forward, expected_backward):
    road = OSMFixtureAdapter().parse(_road_way(tags)).roads[0]

    assert road.forward_lanes == expected_forward
    assert road.backward_lanes == expected_backward


def test_adapter_keeps_one_way_lanes_unsplit():
    payload = _road_way({"highway": "residential", "oneway": "yes", "lanes": "2"})

    road = OSMFixtureAdapter().parse(payload).roads[0]

    assert road.forward_lanes == 2


def test_adapter_raises_ingestion_error_for_poi_way_with_missing_node():
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.079},
            {"type": "way", "id": 10, "nodes": [1, 2, 99, 1], "tags": {"amenity": "restaurant"}},
        ]
    }

    with pytest.raises(OSMIngestionError, match="missing node 99"):
        OSMFixtureAdapter().parse(payload)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("12", 12.0),
        ("12.5", 12.5),
        ("12 m", 12.0),
        ("12m", 12.0),
        (" 12 M ", 12.0),
        ("12,5", 12.5),
        (12, 12.0),
        ("40'", 40 * 0.3048),
        ("40 ft", 40 * 0.3048),
        ("40 feet", 40 * 0.3048),
        ("tall", None),
        ("12;15", None),
        ("10-12", None),
        ("0", None),
        ("-3", None),
        ("", None),
        ("nan", None),
        ("40'6\"", None),
    ],
)
def test_building_height_parsing_keeps_unknown_as_none(value, expected):
    payload = _building_payload({"building": "yes", **({} if value is None else {"height": value})})

    height = OSMFixtureAdapter().parse(payload).buildings[0].height_meters

    assert height == pytest.approx(expected) if expected is not None else height is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, None), ("3", 3), ("3.0", 3), (4, 4), ("0", 0), ("2.5", None), ("-1", None), ("three", None), ("inf", None)],
)
def test_building_levels_parsing_keeps_unknown_as_none(value, expected):
    payload = _building_payload({"building": "yes", **({} if value is None else {"building:levels": value})})

    assert OSMFixtureAdapter().parse(payload).buildings[0].levels == expected


def _building_payload(tags):
    return {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.0799},
            {"type": "node", "id": 3, "lat": 9.9341, "lon": -84.0799},
            {"type": "way", "id": 10, "nodes": [1, 2, 3, 1], "tags": tags},
        ]
    }


@pytest.mark.parametrize(
    ("highway", "expected"),
    [
        ("motorway_link", RoadClassification.MOTORWAY),
        ("trunk_link", RoadClassification.TRUNK),
        ("primary_link", RoadClassification.PRIMARY),
        ("secondary_link", RoadClassification.SECONDARY),
        ("tertiary_link", RoadClassification.TERTIARY),
        ("living_street", RoadClassification.RESIDENTIAL),
    ],
)
def test_link_and_living_street_ways_map_to_existing_classes(highway, expected):
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.079},
            {"type": "way", "id": 10, "nodes": [1, 2], "tags": {"highway": highway}},
        ]
    }

    assert [road.classification for road in OSMFixtureAdapter().parse(payload).roads] == [expected]


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"highway": "primary", "junction": "roundabout"}, 1),
        ({"highway": "primary", "junction": "roundabout", "oneway": "no"}, 0),
        ({"highway": "primary", "junction": "roundabout", "oneway": "-1"}, -1),
        ({"highway": "primary"}, 0),
    ],
)
def test_roundabout_is_one_way_unless_oneway_says_otherwise(tags, expected):
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.079},
            {"type": "way", "id": 10, "nodes": [1, 2], "tags": tags},
        ]
    }

    assert OSMFixtureAdapter().parse(payload).roads[0].one_way_direction == expected


@pytest.mark.parametrize("value", ["reversible", "alternating", "Reversible"])
def test_reversible_and_alternating_oneway_import_as_two_way(value):
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.079},
            {"type": "way", "id": 10, "nodes": [1, 2], "tags": {"highway": "primary", "oneway": value}},
        ]
    }

    assert OSMFixtureAdapter().parse(payload).roads[0].one_way_direction == 0


def test_unknown_oneway_value_still_fails_the_import():
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.934, "lon": -84.080},
            {"type": "node", "id": 2, "lat": 9.934, "lon": -84.079},
            {"type": "way", "id": 10, "nodes": [1, 2], "tags": {"highway": "primary", "oneway": "sometimes"}},
        ]
    }

    with pytest.raises(OSMIngestionError, match="unsupported oneway"):
        OSMFixtureAdapter().parse(payload)


def _restriction_payload(tags):
    payload = json.loads(FIXTURE.read_text())
    for element in payload["elements"]:
        if element["type"] == "relation":
            element["tags"] = {"type": "restriction", **tags}
    return payload


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"restriction": "no_left_turn", "restriction:bus": "only_straight_on"}, [RestrictionKind.NO_LEFT_TURN]),
        ({"restriction:motorcar": "no_u_turn", "restriction:vehicle": "no_left_turn"}, [RestrictionKind.NO_U_TURN]),
        ({"restriction:hgv": "no_left_turn", "restriction:bicycle": "no_right_turn"}, []),
    ],
)
def test_vehicle_scoped_restrictions_apply_only_when_they_bind_a_car(tags, expected):
    assert [r.kind for r in OSMFixtureAdapter().parse(_restriction_payload(tags)).restrictions] == expected


def test_restriction_without_any_restriction_tag_still_fails():
    with pytest.raises(OSMIngestionError, match="unsupported restriction"):
        OSMFixtureAdapter().parse(_restriction_payload({}))
