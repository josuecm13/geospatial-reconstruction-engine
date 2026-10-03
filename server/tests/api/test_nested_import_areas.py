"""An import whose rectangle contains a completed import area skips what that inner area holds
(its buildings, POIs, area features, and interior blocks), keeps the whole road network, and
composes the inner area's features back in on map-data and in the feature-layer spatial queries."""

import json
import math
from concurrent.futures import Executor, Future
from contextlib import nullcontext

import pytest
from sqlalchemy import select

from app.api.dependencies import get_import_jobs, get_job_session_scope
from app.ingestion.jobs import ImportJobRegistry
from app.persistence.models import AreaFeatureModel, BuildingModel, NavigableNodeModel, PointOfInterestModel

# A 4 x 4 grid of residential roads, 0.001° apart, making 3 x 3 road-bounded blocks.
LAT0, LON0, STEP = 10.100, -84.200, 0.001
OUTER_BBOX = {"min_latitude": 10.0995, "min_longitude": -84.2005, "max_latitude": 10.1035, "max_longitude": -84.1965}
# Covers the centre block (rows 1-2, columns 1-2) and cuts through the eight around it.
INNER_BBOX = {"min_latitude": 10.1008, "min_longitude": -84.1992, "max_latitude": 10.1022, "max_longitude": -84.1978}
# Contains the inner box but reaches past the outer one's east edge: only partly overlaps it.
PARTIAL_BBOX = {"min_latitude": 10.1008, "min_longitude": -84.1992, "max_latitude": 10.1022, "max_longitude": -84.1950}

INNER_BUILDING, STRADDLING_BUILDING, OUTER_BUILDING = "300", "301", "302"
INNER_PARK = "400"
INNER_POI, OUTER_POI = "500", "501"


def _grid_node(i: int, j: int) -> int:
    return 1000 + i * 10 + j


def _rectangle(way_id: int, south: float, west: float, north: float, east: float, tags: dict) -> list[dict]:
    corners = [(south, west), (south, east), (north, east), (north, west)]
    node_ids = [way_id * 10 + k for k in range(4)]
    nodes = [{"type": "node", "id": node_id, "lat": lat, "lon": lon} for node_id, (lat, lon) in zip(node_ids, corners)]
    return [*nodes, {"type": "way", "id": way_id, "nodes": [*node_ids, node_ids[0]], "tags": tags}]


def _payload(*, inner_only: bool = False) -> dict:
    """The whole grid and its features, or (`inner_only`) what an Overpass query of the inner box
    returns: the ways and features that intersect it."""
    rows = [1, 2] if inner_only else [0, 1, 2, 3]
    columns = [1, 2] if inner_only else [0, 1, 2, 3]
    elements = [
        {"type": "node", "id": _grid_node(i, j), "lat": round(LAT0 + i * STEP, 6), "lon": round(LON0 + j * STEP, 6)}
        for i in range(4)
        for j in range(4)
    ]
    elements += [
        {"type": "way", "id": 100 + i, "nodes": [_grid_node(i, j) for j in range(4)], "tags": {"highway": "residential"}}
        for i in rows
    ]
    elements += [
        {"type": "way", "id": 200 + j, "nodes": [_grid_node(i, j) for i in range(4)], "tags": {"highway": "residential"}}
        for j in columns
    ]
    elements += _rectangle(int(INNER_BUILDING), 10.1013, -84.1987, 10.1015, -84.1985, {"building": "yes"})
    elements += _rectangle(int(STRADDLING_BUILDING), 10.1005, -84.1985, 10.1009, -84.1983, {"building": "yes"})
    elements += _rectangle(int(INNER_PARK), 10.1016, -84.1989, 10.1018, -84.1987, {"leisure": "park"})
    elements.append({"type": "node", "id": int(INNER_POI), "lat": 10.1017, "lon": -84.1983, "tags": {"amenity": "school", "name": "Inner"}})
    if not inner_only:
        elements += _rectangle(int(OUTER_BUILDING), 10.1003, -84.1997, 10.1005, -84.1995, {"building": "yes"})
        elements.append({"type": "node", "id": int(OUTER_POI), "lat": 10.1025, "lon": -84.1975, "tags": {"amenity": "school", "name": "Outer"}})
    return {"elements": elements}


def _import(client, bbox, payload) -> dict:
    response = client.post("/import-areas", json={"bbox": bbox, "payload": payload})
    assert response.status_code == 200, response.text
    return response.json()


def _import_inner(client) -> dict:
    return _import(client, INNER_BBOX, _payload(inner_only=True))


def _import_outer(client) -> dict:
    return _import(client, OUTER_BBOX, _payload())


def _inside(bbox: dict, longitude: float, latitude: float) -> bool:
    return (
        bbox["min_latitude"] <= latitude <= bbox["max_latitude"]
        and bbox["min_longitude"] <= longitude <= bbox["max_longitude"]
    )


def _ring(feature) -> list:
    return feature["geometry"]["coordinates"][0]


def _source_ids(db_session, model, features) -> list[str]:
    ids = [feature["id"] for feature in features]
    return sorted(db_session.scalars(select(model.source_id).where(model.id.in_(ids))).all())


def test_an_outer_import_stores_none_of_the_inner_areas_features_or_interior_blocks(client):
    inner = _import_inner(client)

    outer = _import_outer(client)

    assert outer["road_count"] == 8, "the road network covers the whole rectangle"
    assert outer["building_count"] == 2
    assert outer["poi_count"] == 1
    assert outer["area_feature_count"] == 0
    # Nine road-bounded blocks; the centre one lies inside the inner area, which holds it.
    assert outer["block_count"] == 8
    own = client.get(f"/import-areas/{outer['id']}/map-data").json()
    outer_blocks = [block for block in own["blocks"]["features"] if block["properties"]["import_area_id"] == outer["id"]]
    assert len(outer_blocks) == 8
    assert not any(all(_inside(INNER_BBOX, *point) for point in _ring(block)) for block in outer_blocks)
    # The eight blocks around the centre straddle the inner edge, so the outer area stores them whole.
    straddling = [
        block for block in outer_blocks
        if any(_inside(INNER_BBOX, *point) for point in _ring(block))
        and not all(_inside(INNER_BBOX, *point) for point in _ring(block))
    ]
    assert len(straddling) == 8
    assert not any(block["properties"]["is_clipped"] for block in outer_blocks)
    assert inner["building_count"] == 2  # the inner building and the one straddling its edge


def test_a_route_crosses_the_inner_area(client):
    _import_inner(client)
    outer = _import_outer(client)

    response = client.post(
        f"/import-areas/{outer['id']}/routes",
        json={
            "origin": {"latitude": LAT0 + STEP, "longitude": LON0},
            "destination": {"latitude": LAT0 + STEP, "longitude": LON0 + 3 * STEP},
        },
    )

    assert response.status_code == 200, response.text
    route = response.json()
    assert any(_inside(INNER_BBOX, *point) for point in route["geometry"]["coordinates"])
    meters_per_degree_longitude = math.pi * 6_371_000.0 / 180 * math.cos(math.radians(LAT0 + STEP))
    assert route["total_distance_meters"] == pytest.approx(3 * STEP * meters_per_degree_longitude, rel=0.01)


def test_map_data_of_the_outer_area_composes_the_inner_area_once(client, db_session):
    inner = _import_inner(client)
    outer = _import_outer(client)

    body = client.get(f"/import-areas/{outer['id']}/map-data").json()

    assert body["scope"] == {"type": "import_area", "id": outer["id"], "composed_area_ids": [inner["id"]]}
    buildings = body["buildings"]["features"]
    assert _source_ids(db_session, BuildingModel, buildings) == [INNER_BUILDING, STRADDLING_BUILDING, OUTER_BUILDING]
    assert len(buildings) == 3, "no source id appears twice"
    owners = {feature["id"]: feature["properties"]["import_area_id"] for feature in buildings}
    inner_building = db_session.scalar(
        select(BuildingModel.id).where(BuildingModel.import_area_id == inner["id"], BuildingModel.source_id == INNER_BUILDING)
    )
    assert owners[str(inner_building)] == inner["id"]
    assert sorted(owners.values()).count(outer["id"]) == 2, "the outer area's own copy of a shared building wins"
    assert _source_ids(db_session, PointOfInterestModel, body["pois"]["features"]) == [INNER_POI, OUTER_POI]
    assert _source_ids(db_session, AreaFeatureModel, body["area_features"]["features"]) == [INNER_PARK]
    assert body["area_features"]["features"][0]["properties"]["import_area_id"] == inner["id"]
    blocks = body["blocks"]["features"]
    assert len(blocks) == 9
    assert [block["properties"]["import_area_id"] for block in blocks].count(inner["id"]) == 1
    assert not any(block["properties"]["is_clipped"] for block in blocks), "an inner area's clipped pieces are left out"
    # The counts describe what the outer area stores, not the composed response.
    assert client.get(f"/import-areas/{outer['id']}").json()["building_count"] == 2


def test_clip_mode_composes_the_inner_area_too(client):
    inner = _import_inner(client)
    outer = _import_outer(client)

    body = client.get(f"/import-areas/{outer['id']}/map-data", params={"mode": "clip"}).json()

    assert body["scope"]["composed_area_ids"] == [inner["id"]]
    assert len(body["buildings"]["features"]) == 3
    assert len(body["blocks"]["features"]) == 9


def test_a_boundary_scope_composes_the_inner_area_filtered_by_the_boundary(client):
    inner = _import_inner(client)
    outer = _import_outer(client)
    ring = [[-84.19895, 10.1011], [-84.1981, 10.1011], [-84.1981, 10.1019], [-84.19895, 10.1019], [-84.19895, 10.1011]]
    boundary = client.post(
        f"/import-areas/{outer['id']}/boundaries", json={"name": "centre", "geometry": {"type": "Polygon", "coordinates": [ring]}}
    )
    assert boundary.status_code == 201, boundary.text

    body = client.get(f"/import-areas/{outer['id']}/map-data", params={"boundary_id": boundary.json()["id"]}).json()

    assert body["scope"] == {"type": "boundary", "id": boundary.json()["id"], "composed_area_ids": [inner["id"]]}
    for layer in ("blocks", "buildings", "pois", "area_features"):
        features = body[layer]["features"]
        assert len(features) == 1, layer
        assert features[0]["properties"]["import_area_id"] == inner["id"], layer


def test_reimporting_an_outer_area_removes_its_copies_and_keeps_its_block_ids(client):
    first = _import_outer(client)
    before = client.get(f"/import-areas/{first['id']}/map-data").json()
    blocks_before = {block["id"]: block for block in before["blocks"]["features"]}
    assert first["building_count"] == 3 and len(blocks_before) == 9
    inner = _import_inner(client)

    again = _import_outer(client)

    assert again["id"] == first["id"]
    assert again["building_count"] == 2
    assert again["poi_count"] == 1
    assert again["area_feature_count"] == 0
    after = client.get(f"/import-areas/{again['id']}/map-data").json()
    own_after = [block for block in after["blocks"]["features"] if block["properties"]["import_area_id"] == again["id"]]
    assert len(own_after) == 8
    # Dropping the centre block renumbers nothing: every surviving block keeps its id and shape.
    for block in own_after:
        assert block["id"] in blocks_before
        assert block["geometry"] == blocks_before[block["id"]]["geometry"]
    dropped = [blocks_before[block_id] for block_id in set(blocks_before) - {block["id"] for block in own_after}]
    assert len(dropped) == 1
    assert all(_inside(INNER_BBOX, *point) for point in _ring(dropped[0]))
    assert len(after["buildings"]["features"]) == 3
    assert [feature["properties"]["import_area_id"] for feature in after["buildings"]["features"]].count(inner["id"]) == 1


def test_a_partly_overlapping_area_is_imported_in_full(client):
    partial = _import(client, PARTIAL_BBOX, _payload(inner_only=True))

    outer = _import_outer(client)

    assert outer["building_count"] == 3
    assert outer["poi_count"] == 2
    assert outer["area_feature_count"] == 1
    assert outer["block_count"] == 9
    body = client.get(f"/import-areas/{outer['id']}/map-data").json()
    assert body["scope"]["composed_area_ids"] == []
    assert partial["id"] not in {feature["properties"]["import_area_id"] for feature in body["buildings"]["features"]}


def _nearby(client, area_id, latitude, longitude, radius_meters, kind, **params) -> list[dict]:
    response = client.get(
        f"/import-areas/{area_id}/nearby",
        params={"latitude": latitude, "longitude": longitude, "radius_meters": radius_meters, "kind": kind, **params},
    )
    assert response.status_code == 200, response.text
    return response.json()["results"]


def _within_inner_bbox(client, area_id, kind, mode) -> list[dict]:
    response = client.get(f"/import-areas/{area_id}/within-bbox", params={**INNER_BBOX, "kind": kind, "mode": mode})
    assert response.status_code == 200, response.text
    return response.json()["results"]


def _building_id(db_session, area_id, source_id):
    return db_session.scalar(
        select(BuildingModel.id).where(BuildingModel.import_area_id == area_id, BuildingModel.source_id == source_id)
    )


def test_nearby_on_the_outer_area_finds_the_inner_areas_building(client, db_session):
    inner = _import_inner(client)
    outer = _import_outer(client)

    results = _nearby(client, outer["id"], 10.1014, -84.1986, 15, "building")

    assert _source_ids(db_session, BuildingModel, results) == [INNER_BUILDING]
    assert results[0]["properties"]["import_area_id"] == inner["id"]


def test_nearby_returns_a_shared_building_once_as_the_outer_copy(client, db_session):
    _import_inner(client)
    outer = _import_outer(client)

    # 60 m from between the inner and straddling buildings reaches both, and not the outer one.
    results = _nearby(client, outer["id"], 10.1011, -84.1985, 60, "building")

    assert _source_ids(db_session, BuildingModel, results) == [INNER_BUILDING, STRADDLING_BUILDING]
    assert len(results) == 2, "no source id appears twice"
    straddling = _building_id(db_session, outer["id"], STRADDLING_BUILDING)
    owners = {feature["id"]: feature["properties"]["import_area_id"] for feature in results}
    assert owners[str(straddling)] == outer["id"]


def test_nearby_on_the_outer_area_finds_the_inner_areas_poi_and_park(client, db_session):
    inner = _import_inner(client)
    outer = _import_outer(client)

    pois = _nearby(client, outer["id"], 10.1017, -84.1983, 10, "poi")
    parks = _nearby(client, outer["id"], 10.1017, -84.1988, 10, "area_feature")

    assert _source_ids(db_session, PointOfInterestModel, pois) == [INNER_POI]
    assert pois[0]["properties"]["import_area_id"] == inner["id"]
    assert _source_ids(db_session, AreaFeatureModel, parks) == [INNER_PARK]
    assert parks[0]["properties"]["import_area_id"] == inner["id"]


@pytest.mark.parametrize(
    ("mode", "expected"),
    [("intersects", [INNER_BUILDING, STRADDLING_BUILDING]), ("contains", [INNER_BUILDING])],
)
def test_within_bbox_on_the_outer_area_composes_the_inner_areas_buildings(client, db_session, mode, expected):
    _import_inner(client)
    outer = _import_outer(client)

    results = _within_inner_bbox(client, outer["id"], "building", mode)

    assert _source_ids(db_session, BuildingModel, results) == expected
    assert len(results) == len(expected), "no source id appears twice"


def test_within_bbox_nodes_stay_the_outer_areas_own(client, db_session):
    _import_inner(client)
    outer = _import_outer(client)

    results = _within_inner_bbox(client, outer["id"], "node", "intersects")

    assert results, "the outer area's network crosses the inner box"
    owners = db_session.scalars(
        select(NavigableNodeModel.import_area_id).where(NavigableNodeModel.id.in_([node["id"] for node in results]))
    ).all()
    assert {str(owner) for owner in owners} == {outer["id"]}, "the road network is never composed"


def test_footprint_area_on_the_outer_area_answers_for_exactly_the_buildings_map_data_returns(client, db_session):
    inner = _import_inner(client)
    outer = _import_outer(client)

    def footprint(building_id):
        return client.get(f"/import-areas/{outer['id']}/buildings/{building_id}/footprint-area")

    inner_building = footprint(_building_id(db_session, inner["id"], INNER_BUILDING))
    assert inner_building.status_code == 200, inner_building.text
    assert inner_building.json()["area_square_meters"] > 0
    assert footprint(_building_id(db_session, outer["id"], STRADDLING_BUILDING)).status_code == 200
    # The inner area holds its own copy of the straddling building; map-data shows the outer copy.
    shadowed = footprint(_building_id(db_session, inner["id"], STRADDLING_BUILDING))
    assert shadowed.status_code == 404
    assert shadowed.json()["error"]["code"] == "building_not_found"


def test_a_boundary_scoped_spatial_query_composes_the_inner_area(client, db_session):
    inner = _import_inner(client)
    outer = _import_outer(client)
    ring = [[-84.19895, 10.1011], [-84.1981, 10.1011], [-84.1981, 10.1019], [-84.19895, 10.1019], [-84.19895, 10.1011]]
    boundary = client.post(
        f"/import-areas/{outer['id']}/boundaries", json={"name": "centre", "geometry": {"type": "Polygon", "coordinates": [ring]}}
    )
    assert boundary.status_code == 201, boundary.text

    # Without the boundary this radius also reaches the straddling building, which lies outside it.
    results = _nearby(client, outer["id"], 10.1011, -84.1985, 60, "building", boundary_id=boundary.json()["id"])

    assert _source_ids(db_session, BuildingModel, results) == [INNER_BUILDING]
    assert results[0]["properties"]["import_area_id"] == inner["id"]


def test_spatial_queries_on_the_inner_area_are_its_own(client, db_session):
    inner = _import_inner(client)
    _import_outer(client)

    results = _nearby(client, inner["id"], 10.1011, -84.1985, 60, "building")

    assert _source_ids(db_session, BuildingModel, results) == [INNER_BUILDING, STRADDLING_BUILDING]
    assert {feature["properties"]["import_area_id"] for feature in results} == {inner["id"]}


class _InlineExecutor(Executor):
    def submit(self, fn, /, *args, **kwargs):
        future = Future()
        fn(*args, **kwargs)
        future.set_result(None)
        return future


def _events(client, area_id) -> list[dict]:
    response = client.get(f"/import-areas/{area_id}/events")
    assert response.status_code == 200
    events = []
    for block in filter(None, response.text.split("\n\n")):
        fields = dict(line.split(": ", 1) for line in block.split("\n"))
        events.append({"stage": fields["event"], "data": json.loads(fields["data"])})
    return events


def test_the_event_stream_names_the_inner_areas_and_sends_none_of_their_buildings(client, db_session):
    registry = ImportJobRegistry(executor=_InlineExecutor())
    client.app.dependency_overrides[get_import_jobs] = lambda: registry
    client.app.dependency_overrides[get_job_session_scope] = lambda: lambda: nullcontext(db_session)
    inner = _import_inner(client)

    started = client.post("/import-areas", json={"bbox": OUTER_BBOX, "payload": _payload(), "background": True})
    assert started.status_code == 202
    outer_id = started.json()["import_area_id"]
    events = _events(client, outer_id)

    assert events[0]["stage"] == "fetched"
    assert events[0]["data"]["inner_area_ids"] == [inner["id"]]
    assert events[-1]["stage"] == "completed"
    streamed = [
        feature for event in events if event["stage"] == "buildings" for feature in event["data"]["buildings"]["features"]
    ]
    assert {feature["properties"]["import_area_id"] for feature in streamed} == {outer_id}
    assert _source_ids(db_session, BuildingModel, streamed) == [STRADDLING_BUILDING, OUTER_BUILDING]
