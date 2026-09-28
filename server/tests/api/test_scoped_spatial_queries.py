"""Spatial queries scoped to a traced boundary (Milestone 8, #49), over the
osm_neighborhood fixture: nodes 1–4 on a star of three roads from node 2, a
building to the west, a park and a school to the east."""

import json
import uuid
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"
BBOX = {"min_latitude": 9.933, "min_longitude": -84.081, "max_latitude": 9.935, "max_longitude": -84.079}
# West of -84.0801: node 1, the building, and the western end of West Street (1 → 2).
WEST = [[-84.081, 9.933], [-84.0801, 9.933], [-84.0801, 9.935], [-84.081, 9.935], [-84.081, 9.933]]
# East of -84.07995: node 3, the school, the park, and the eastern end of East Street (2 → 3).
EAST = [[-84.07995, 9.933], [-84.079, 9.933], [-84.079, 9.935], [-84.07995, 9.935], [-84.07995, 9.933]]


@pytest.fixture()
def area(client):
    response = client.post("/import-areas", json={"bbox": BBOX, "payload": json.loads(FIXTURE.read_text())})
    assert response.status_code == 200, response.text
    area = response.json()
    for name, ring in (("West", WEST), ("East", EAST)):
        created = client.post(
            f"/import-areas/{area['id']}/boundaries",
            json={"name": name, "geometry": {"type": "Polygon", "coordinates": [ring]}},
        )
        assert created.status_code == 201, created.text
        area[name] = created.json()["id"]
    return area


def _ids(response):
    assert response.status_code == 200, response.text
    return {feature["id"] for feature in response.json()["results"]}


def _nearby(client, area, kind, boundary_id=None):
    params = {"latitude": 9.934, "longitude": -84.08, "radius_meters": 500, "kind": kind}
    if boundary_id:
        params["boundary_id"] = boundary_id
    return client.get(f"/import-areas/{area['id']}/nearby", params=params)


@pytest.mark.parametrize("kind", ["node", "poi", "building", "area_feature"])
def test_nearby_scoped_to_a_boundary_returns_only_what_intersects_it(client, area, kind):
    everything = _ids(_nearby(client, area, kind))
    west = _ids(_nearby(client, area, kind, area["West"]))
    east = _ids(_nearby(client, area, kind, area["East"]))

    assert everything, f"the fixture must have {kind}s for this test to mean anything"
    assert west <= everything and east <= everything
    assert not west & east
    expected = {"node": (1, 1), "poi": (0, 1), "building": (1, 0), "area_feature": (0, 1)}[kind]
    assert (len(west), len(east)) == expected


@pytest.mark.parametrize("mode", ["intersects", "contains"])
def test_within_bbox_scoped_to_a_boundary(client, area, mode):
    def query(boundary_id=None):
        params = {**BBOX, "kind": "node", "mode": mode}
        if boundary_id:
            params["boundary_id"] = boundary_id
        return _ids(client.get(f"/import-areas/{area['id']}/within-bbox", params=params))

    assert len(query()) == 4
    assert len(query(area["West"])) == 1
    assert len(query(area["East"])) == 1


def _nearest(client, area, kind, longitude, boundary_id=None):
    params = {"latitude": 9.934, "longitude": longitude, "kind": kind}
    if boundary_id:
        params["boundary_id"] = boundary_id
    response = client.get(f"/import-areas/{area['id']}/nearest", params=params)
    assert response.status_code == 200, response.text
    return response.json()["result"]


def test_nearest_node_is_searched_only_inside_the_boundary(client, area):
    # Node 2 sits at -84.08, outside both boundaries.
    unscoped = _nearest(client, area, "node", -84.08)
    west = _nearest(client, area, "node", -84.08, area["West"])

    assert unscoped["geometry"]["coordinates"] == [-84.08, 9.934]
    assert west["geometry"]["coordinates"] == [-84.0805, 9.934]


def test_nearest_segment_is_searched_only_inside_the_boundary(client, area):
    # From the east end, the closest segment is East Street; inside West only West Street's remain.
    unscoped = _nearest(client, area, "segment", -84.0796)
    west = _nearest(client, area, "segment", -84.0796, area["West"])

    assert max(lon for lon, _ in unscoped["geometry"]["coordinates"]) > -84.0799
    assert min(lon for lon, _ in west["geometry"]["coordinates"]) < -84.0801


def test_unknown_or_foreign_boundary_is_not_found(client, area):
    other_bbox = {**BBOX, "min_latitude": 9.936, "max_latitude": 9.937}
    other = client.post("/import-areas", json={"bbox": other_bbox, "payload": {"elements": []}}).json()
    ring = [[-84.081, 9.936], [-84.08, 9.936], [-84.08, 9.937], [-84.081, 9.937], [-84.081, 9.936]]
    foreign = client.post(
        f"/import-areas/{other['id']}/boundaries",
        json={"name": "Other", "geometry": {"type": "Polygon", "coordinates": [ring]}},
    ).json()["id"]

    for boundary_id in (str(uuid.uuid4()), foreign):
        responses = [
            _nearby(client, area, "node", boundary_id),
            client.get(
                f"/import-areas/{area['id']}/within-bbox",
                params={**BBOX, "kind": "node", "mode": "intersects", "boundary_id": boundary_id},
            ),
            client.get(
                f"/import-areas/{area['id']}/nearest",
                params={"latitude": 9.934, "longitude": -84.08, "kind": "node", "boundary_id": boundary_id},
            ),
        ]
        for response in responses:
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "boundary_not_found"
