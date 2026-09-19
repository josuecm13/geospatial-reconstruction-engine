import json
from pathlib import Path

import pytest

from app.domain.enums import BuildingCategory, PoiCategory, RestrictionKind
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
