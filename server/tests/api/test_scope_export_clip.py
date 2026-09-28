"""Scope export in clip mode (Milestone 8, #51): geometry cut at the scope, for rendering."""

import json
from pathlib import Path

import pytest
from shapely.geometry import shape

FIXTURES = Path(__file__).parents[1] / "fixtures"
BBOX = {"min_latitude": 9.933, "min_longitude": -84.081, "max_latitude": 9.935, "max_longitude": -84.079}
LOOP_BBOX = {"min_latitude": 9.9398, "min_longitude": -84.0902, "max_latitude": 9.9407, "max_longitude": -84.0893}
WEST = [[-84.081, 9.933], [-84.0801, 9.933], [-84.0801, 9.935], [-84.081, 9.935], [-84.081, 9.933]]
LAYERS = ("road_segments", "navigable_nodes", "blocks", "buildings", "pois", "area_features")
# The building spans lon -84.0804 to -84.0802; this boundary ends exactly at its west edge.
TOUCHING_THE_BUILDING = [[-84.081, 9.933], [-84.0804, 9.933], [-84.0804, 9.935], [-84.081, 9.935], [-84.081, 9.933]]
# A "U" open to the north. Its prongs cross West Street (lat 9.934, lon -84.0805 to -84.08) twice.
U_SHAPE = [
    [-84.0806, 9.9335], [-84.0799, 9.9335], [-84.0799, 9.9345], [-84.0802, 9.9345], [-84.0802, 9.9338],
    [-84.0804, 9.9338], [-84.0804, 9.9345], [-84.0806, 9.9345], [-84.0806, 9.9335],
]


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


def _bbox_ring(bbox):
    lo_lon, lo_lat, hi_lon, hi_lat = bbox["min_longitude"], bbox["min_latitude"], bbox["max_longitude"], bbox["max_latitude"]
    return [[lo_lon, lo_lat], [hi_lon, lo_lat], [hi_lon, hi_lat], [lo_lon, hi_lat], [lo_lon, lo_lat]]


def _assert_contained(body, ring):
    # A hair of tolerance: the intersection's vertices are computed in floating point.
    scope = shape({"type": "Polygon", "coordinates": [ring]}).buffer(1e-12)
    for layer in LAYERS:
        for feature in body[layer]["features"]:
            assert scope.contains(shape(feature["geometry"])), (layer, feature["geometry"])
            buildable = feature["properties"].get("buildable_area")
            if buildable:
                assert scope.contains(shape(buildable)), (layer, "buildable_area", buildable)


@pytest.fixture()
def neighborhood(client):
    return _import(client, BBOX, "osm_neighborhood.json")


def test_clip_mode_cuts_geometry_at_the_boundary_where_filter_mode_does_not(client, neighborhood):
    west = _boundary(client, neighborhood, "West", WEST)
    filtered = _map_data(client, neighborhood, boundary_id=west)
    clipped = _map_data(client, neighborhood, boundary_id=west, mode="clip")

    assert filtered["mode"] == "filter" and clipped["mode"] == "clip"
    assert clipped["scope"] == {"type": "boundary", "id": west}
    with pytest.raises(AssertionError):
        _assert_contained(filtered, WEST)
    _assert_contained(clipped, WEST)
    # The same segments survive, cut short: West Street now ends at the boundary's edge.
    assert {f["id"] for f in clipped["road_segments"]["features"]} == {f["id"] for f in filtered["road_segments"]["features"]}
    ends = [lon for f in clipped["road_segments"]["features"] for lon, _ in f["geometry"]["coordinates"]]
    assert max(ends) == pytest.approx(-84.0801, abs=1e-9)
    # Node 2 was only there as a segment's endpoint; a clipped export isn't routable, so it goes.
    assert len(clipped["navigable_nodes"]["features"]) == 1


def test_clip_mode_on_the_whole_area_is_contained_by_the_rectangle(client):
    # East Street runs to node 3 at -84.0795, past this box's east edge.
    narrow = {**BBOX, "max_longitude": -84.0797}
    area_id = _import(client, narrow, "osm_neighborhood.json")

    filtered = _map_data(client, area_id)
    clipped = _map_data(client, area_id, mode="clip")

    assert clipped["scope"] == {"type": "import_area", "id": area_id}
    with pytest.raises(AssertionError):
        _assert_contained(filtered, _bbox_ring(narrow))
    _assert_contained(clipped, _bbox_ring(narrow))


def test_a_crossing_twice_yields_a_multi_part_geometry(client, neighborhood):
    u_shape = _boundary(client, neighborhood, "U", U_SHAPE)

    body = _map_data(client, neighborhood, boundary_id=u_shape, mode="clip")

    _assert_contained(body, U_SHAPE)
    # West Street (node 1 → node 2) enters both prongs; the other streets meet only the east prong.
    node_1 = next(f["id"] for f in body["navigable_nodes"]["features"] if f["geometry"]["coordinates"] == [-84.0805, 9.934])
    west_street = [f for f in body["road_segments"]["features"] if node_1 in (f["properties"]["from_node_id"], f["properties"]["to_node_id"])]
    assert west_street
    for feature in west_street:
        assert feature["geometry"]["type"] == "MultiLineString"
        assert len(feature["geometry"]["coordinates"]) == 2


def test_an_entity_touching_only_the_edge_is_omitted(client, neighborhood):
    touching = _boundary(client, neighborhood, "Touching", TOUCHING_THE_BUILDING)

    filtered = _map_data(client, neighborhood, boundary_id=touching)
    clipped = _map_data(client, neighborhood, boundary_id=touching, mode="clip")

    # Filter mode keeps the building (it intersects the boundary); clipping leaves only a line of it.
    assert len(filtered["buildings"]["features"]) == 1
    assert clipped["buildings"]["features"] == []


def test_blocks_and_their_buildable_area_are_clipped(client):
    area_id = _import(client, LOOP_BBOX, "osm_block_loop.json")
    # The west half of the loop's block (lon -84.09 to -84.0895).
    west_half = [[-84.0902, 9.9398], [-84.08975, 9.9398], [-84.08975, 9.9407], [-84.0902, 9.9407], [-84.0902, 9.9398]]
    boundary = _boundary(client, area_id, "West half", west_half)

    whole = _map_data(client, area_id, boundary_id=boundary)["blocks"]["features"][0]
    clipped = _map_data(client, area_id, boundary_id=boundary, mode="clip")

    _assert_contained(clipped, west_half)
    block = clipped["blocks"]["features"][0]
    assert shape(block["geometry"]).area < shape(whole["geometry"]).area
    assert shape(block["properties"]["buildable_area"]).area < shape(whole["properties"]["buildable_area"]).area
