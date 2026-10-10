"""Elevation in map-data (Milestone 10, #139): the grid, building bases, and road vertex heights."""

import json
from pathlib import Path

import pytest

from app.api.dependencies import get_elevation_source
from tests.api.elevation_stubs import SlopedSource
from tests.api.test_background_import import InlineExecutor, _use_registry

FIXTURES = Path(__file__).parents[1] / "fixtures"
BBOX = {"min_latitude": 9.933, "min_longitude": -84.081, "max_latitude": 9.935, "max_longitude": -84.079}
WEST = [[-84.081, 9.933], [-84.0801, 9.933], [-84.0801, 9.935], [-84.081, 9.935], [-84.081, 9.933]]
BASE, SLOPE = 10.0, 0.5


@pytest.fixture()
def area_id(client, db_session):
    _use_registry(client, db_session, InlineExecutor())
    payload = json.loads((FIXTURES / "osm_neighborhood.json").read_text())
    response = client.post("/import-areas", json={"bbox": BBOX, "payload": payload})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _analyse(client, area_id):
    client.app.dependency_overrides[get_elevation_source] = lambda: SlopedSource(BASE, SLOPE)
    assert client.post(f"/import-areas/{area_id}/elevation").status_code == 202


def _map_data(client, area_id, **params):
    response = client.get(f"/import-areas/{area_id}/map-data", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _boundary(client, area_id, ring):
    response = client.post(
        f"/import-areas/{area_id}/boundaries", json={"name": "West", "geometry": {"type": "Polygon", "coordinates": [ring]}}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _vertex_count(geometry):
    coordinates = geometry["coordinates"]
    return len(coordinates) if geometry["type"] == "LineString" else sum(len(part) for part in coordinates)


def _vertices(geometry):
    coordinates = geometry["coordinates"]
    lines = [coordinates] if geometry["type"] == "LineString" else coordinates
    return [(lon, lat) for line in lines for lon, lat in line]


def test_an_area_that_was_never_analysed_has_null_elevation(client, area_id):
    body = _map_data(client, area_id)

    assert body["elevation"] is None
    assert body["buildings"]["features"]
    for feature in body["buildings"]["features"]:
        assert feature["properties"]["base_elevation_meters"] is None
    for feature in body["road_segments"]["features"]:
        assert feature["properties"]["elevation_exact"] is None
        assert feature["properties"]["elevation_smoothed"] is None


def test_an_analysed_area_serves_its_grid_building_bases_and_segment_heights(client, area_id):
    _analyse(client, area_id)

    body = _map_data(client, area_id)

    elevation = body["elevation"]
    grid = elevation["grid"]
    assert elevation["source"] == "aws-terrain-tiles" and elevation["version"] == 1
    assert elevation["smoothing_meters"] == 30.0
    assert elevation["attribution"].startswith("Terrain: AWS Terrain Tiles")
    assert body["attribution"] == "© OpenStreetMap contributors"
    assert grid["origin"] == {"latitude": BBOX["min_latitude"], "longitude": BBOX["min_longitude"]}
    assert len(grid["heights"]) == grid["rows"] * grid["cols"]
    assert grid["heights"][:grid["cols"]] == [round(BASE + SLOPE * col, 1) for col in range(grid["cols"])]
    top = BASE + SLOPE * (grid["cols"] - 1)
    for feature in body["buildings"]["features"]:
        assert BASE <= feature["properties"]["base_elevation_meters"] <= top
    assert body["road_segments"]["features"]
    for feature in body["road_segments"]["features"]:
        exact, smooth = feature["properties"]["elevation_exact"], feature["properties"]["elevation_smoothed"]
        assert len(exact) == len(smooth) == _vertex_count(feature["geometry"])


def test_a_boundary_scope_still_carries_the_whole_areas_grid(client, area_id):
    _analyse(client, area_id)
    west = _boundary(client, area_id, WEST)

    whole = _map_data(client, area_id)
    scoped = _map_data(client, area_id, boundary_id=west)

    assert scoped["elevation"] == whole["elevation"]
    assert scoped["road_segments"]["features"]
    for feature in scoped["road_segments"]["features"]:
        assert len(feature["properties"]["elevation_exact"]) == _vertex_count(feature["geometry"])


def test_clip_mode_samples_the_grid_again_at_the_clipped_vertices(client, area_id):
    _analyse(client, area_id)
    west = _boundary(client, area_id, WEST)
    filtered = {f["id"]: f for f in _map_data(client, area_id, boundary_id=west)["road_segments"]["features"]}

    clipped = _map_data(client, area_id, boundary_id=west, mode="clip")

    grid = clipped["elevation"]["grid"]
    segments = clipped["road_segments"]["features"]
    assert segments
    cut = 0
    for feature in segments:
        vertices = _vertices(feature["geometry"])
        exact, smooth = feature["properties"]["elevation_exact"], feature["properties"]["elevation_smoothed"]
        assert len(exact) == len(smooth) == len(vertices)
        for (lon, _), height in zip(vertices, exact):
            column = (lon - grid["origin"]["longitude"]) / grid["lon_step"]
            assert height == pytest.approx(BASE + SLOPE * column, abs=1e-3)
        if feature["geometry"] != filtered[feature["id"]]["geometry"]:
            cut += 1
            # The stored heights were for the whole segment; these are the cut one's.
            assert exact != filtered[feature["id"]]["properties"]["elevation_exact"]
    assert cut, "the boundary should cut at least one segment"
