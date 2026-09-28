"""Scope export in filter mode (Milestone 8, #50): map-data for the whole import
area or one traced boundary, with complete blocks and local projection metadata."""

import json
import math
import uuid
from pathlib import Path

import pytest

from app.domain.geometry import EARTH_RADIUS_METERS

FIXTURES = Path(__file__).parents[1] / "fixtures"
BBOX = {"min_latitude": 9.933, "min_longitude": -84.081, "max_latitude": 9.935, "max_longitude": -84.079}
LOOP_BBOX = {"min_latitude": 9.9398, "min_longitude": -84.0902, "max_latitude": 9.9407, "max_longitude": -84.0893}
# West of -84.0801: node 1, the building, and the western part of West Street (node 1 → node 2 at -84.08).
WEST = [[-84.081, 9.933], [-84.0801, 9.933], [-84.0801, 9.935], [-84.081, 9.935], [-84.081, 9.933]]


def _ring(bbox):
    lo_lon, lo_lat, hi_lon, hi_lat = bbox["min_longitude"], bbox["min_latitude"], bbox["max_longitude"], bbox["max_latitude"]
    return [[lo_lon, lo_lat], [hi_lon, lo_lat], [hi_lon, hi_lat], [lo_lon, hi_lat], [lo_lon, lo_lat]]


def _import(client, bbox, fixture):
    response = client.post("/import-areas", json={"bbox": bbox, "payload": json.loads((FIXTURES / fixture).read_text())})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _boundary(client, area_id, name, ring):
    response = client.post(
        f"/import-areas/{area_id}/boundaries", json={"name": name, "geometry": {"type": "Polygon", "coordinates": [ring]}}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _map_data(client, area_id, **params):
    response = client.get(f"/import-areas/{area_id}/map-data", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _ids(body, layer):
    return {feature["id"] for feature in body[layer]["features"]}


@pytest.fixture()
def neighborhood(client):
    return _import(client, BBOX, "osm_neighborhood.json")


def test_whole_area_export_states_scope_mode_and_projection(client, neighborhood):
    body = _map_data(client, neighborhood)

    assert body["scope"] == {"type": "import_area", "id": neighborhood}
    assert body["mode"] == "filter"
    projection = body["projection"]
    assert projection["origin"] == pytest.approx({"latitude": 9.934, "longitude": -84.08})
    meters_per_degree = math.pi * EARTH_RADIUS_METERS / 180
    assert projection["meters_per_degree_latitude"] == pytest.approx(meters_per_degree)
    assert projection["meters_per_degree_longitude"] == pytest.approx(meters_per_degree * math.cos(math.radians(9.934)))


def test_boundary_export_returns_whole_entities_intersecting_the_boundary(client, neighborhood):
    west = _boundary(client, neighborhood, "West", WEST)
    everything = _map_data(client, neighborhood)
    body = _map_data(client, neighborhood, boundary_id=west)

    assert body["scope"] == {"type": "boundary", "id": west}
    assert body["mode"] == "filter"
    assert len(body["buildings"]["features"]) == 1
    assert body["pois"]["features"] == []
    assert body["area_features"]["features"] == []

    # West Street's segments are returned whole, so their geometry runs past the edge at -84.0801 ...
    segments = body["road_segments"]["features"]
    assert segments and _ids(body, "road_segments") < _ids(everything, "road_segments")
    assert max(lon for feature in segments for lon, _ in feature["geometry"]["coordinates"]) > -84.0801
    # ... and every segment still ends at a navigable node in the export, so the result stays routable,
    # even node 2, which is outside the boundary.
    node_ids = _ids(body, "navigable_nodes")
    for feature in segments:
        assert {str(feature["properties"]["from_node_id"]), str(feature["properties"]["to_node_id"])} <= node_ids
    assert [-84.08, 9.934] in [feature["geometry"]["coordinates"] for feature in body["navigable_nodes"]["features"]]
    # Nodes 3 and 4 belong to no West segment and lie outside it.
    assert len(node_ids) == 2

    # The projection is centred on the boundary, not on the import area.
    assert body["projection"]["origin"] == pytest.approx({"latitude": 9.934, "longitude": -84.08055})


def test_whole_area_equals_a_boundary_covering_the_whole_rectangle(client, neighborhood):
    whole = _boundary(client, neighborhood, "Whole", _ring(BBOX))

    area_export = _map_data(client, neighborhood)
    boundary_export = _map_data(client, neighborhood, boundary_id=whole)

    assert area_export.pop("scope") == {"type": "import_area", "id": neighborhood}
    assert boundary_export.pop("scope") == {"type": "boundary", "id": whole}
    assert area_export == boundary_export


def test_blocks_carry_buildable_area_and_flags(client):
    area_id = _import(client, LOOP_BBOX, "osm_block_loop.json")

    blocks = _map_data(client, area_id)["blocks"]["features"]

    assert len(blocks) == 1
    properties = blocks[0]["properties"]
    assert properties["buildable_area"]["type"] == "MultiPolygon"
    assert 0 < properties["buildable_area_square_meters"] < properties["area_square_meters"]
    assert properties["is_median"] is False
    assert properties["is_clipped"] is False


def test_unknown_boundary_is_not_found(client, neighborhood):
    response = client.get(f"/import-areas/{neighborhood}/map-data", params={"boundary_id": str(uuid.uuid4())})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "boundary_not_found"


def test_blocks_and_buildings_follow_the_scope(client):
    # The loop's block spans lat 9.94–9.9405, lon -84.09 – -84.0895, with the house inside it.
    area_id = _import(client, LOOP_BBOX, "osm_block_loop.json")
    corner = _boundary(
        client, area_id, "Corner",
        [[-84.0902, 9.9398], [-84.0901, 9.9398], [-84.0901, 9.9399], [-84.0902, 9.9399], [-84.0902, 9.9398]],
    )
    interior = _boundary(
        client, area_id, "Interior",
        [[-84.08995, 9.94005], [-84.08955, 9.94005], [-84.08955, 9.94045], [-84.08995, 9.94045], [-84.08995, 9.94005]],
    )

    outside = _map_data(client, area_id, boundary_id=corner)
    inside = _map_data(client, area_id, boundary_id=interior)

    assert outside["blocks"]["features"] == [] and outside["buildings"]["features"] == []
    assert outside["road_segments"]["features"] == [] and outside["navigable_nodes"]["features"] == []
    assert len(inside["blocks"]["features"]) == 1 and len(inside["buildings"]["features"]) == 1
    assert inside["road_segments"]["features"] == []
