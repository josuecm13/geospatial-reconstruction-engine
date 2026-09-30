import json
from pathlib import Path

import pytest

from app.ingestion.osm_adapter import OSMFixtureAdapter, OSMIngestionError
from app.ingestion.overpass import with_way_nodes_from_geometry

LIVE_FIXTURE = Path(__file__).parents[1] / "fixtures" / "overpass" / "rosenthaler_platz_small.json"


def _way(way_id, nodes, geometry, tags=None):
    return {"type": "way", "id": way_id, "nodes": nodes, "geometry": geometry, "tags": tags or {"highway": "residential"}}


def test_missing_way_nodes_are_added_from_inline_geometry():
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 1.0, "lon": 2.0},
            _way(10, [1, 2, 3], [{"lat": 9.0, "lon": 9.0}, {"lat": 1.5, "lon": 2.5}, {"lat": 1.6, "lon": 2.6}]),
            _way(11, [3, 4], [{"lat": 1.6, "lon": 2.6}, None]),
        ]
    }

    nodes = [(e["id"], e["lat"], e["lon"]) for e in with_way_nodes_from_geometry(payload)["elements"] if e["type"] == "node"]

    # The present node keeps its own coordinates, a shared node is added once, and a missing
    # geometry entry adds nothing.
    assert sorted(nodes) == [(1, 1.0, 2.0), (2, 1.5, 2.5), (3, 1.6, 2.6)]


def test_payload_without_inline_geometry_is_returned_unchanged():
    payload = {"elements": [{"type": "way", "id": 1, "nodes": [1, 2], "tags": {"highway": "residential"}}]}

    assert with_way_nodes_from_geometry(payload) is payload


def test_recorded_live_response_parses_only_with_geometry_nodes():
    payload = json.loads(LIVE_FIXTURE.read_text())

    with pytest.raises(OSMIngestionError, match="missing node"):
        OSMFixtureAdapter().parse(payload)
    records = OSMFixtureAdapter().parse(with_way_nodes_from_geometry(payload))

    assert len(records.roads) > 0 and len(records.buildings) > 0
