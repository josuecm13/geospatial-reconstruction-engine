import json
import uuid
from pathlib import Path

import pytest

LOOP_FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_block_loop.json"
LOOP_BBOX = {
    "min_latitude": 9.9398, "min_longitude": -84.0902, "max_latitude": 9.9407, "max_longitude": -84.0893,
}
OTHER_BBOX = {
    "min_latitude": 9.9408, "min_longitude": -84.0902, "max_latitude": 9.9417, "max_longitude": -84.0893,
}


def _import(client, bbox=LOOP_BBOX) -> dict:
    payload = json.loads(LOOP_FIXTURE.read_text()) if bbox is LOOP_BBOX else {"elements": []}
    response = client.post("/import-areas", json={"bbox": bbox, "payload": payload})
    assert response.status_code == 200, response.text
    return response.json()


def _square(bbox, fraction=0.5):
    """The south-west `fraction` of a bbox, as a closed GeoJSON ring of [lon, lat]."""
    lon0, lat0 = bbox["min_longitude"], bbox["min_latitude"]
    if fraction == 1.0:
        # Exactly the bbox: arithmetic could land a floating-point hair outside it.
        lon1, lat1 = bbox["max_longitude"], bbox["max_latitude"]
    else:
        lon1 = lon0 + (bbox["max_longitude"] - lon0) * fraction
        lat1 = lat0 + (bbox["max_latitude"] - lat0) * fraction
    return [[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]


def _polygon(ring, *holes):
    return {"type": "Polygon", "coordinates": [ring, *holes]}


def _create(client, area_id, name="South-west", geometry=None):
    return client.post(
        f"/import-areas/{area_id}/boundaries",
        json={"name": name, "geometry": geometry or _polygon(_square(LOOP_BBOX))},
    )


def test_create_fetch_list_and_delete(client):
    area = _import(client)

    created = _create(client, area["id"])
    assert created.status_code == 201, created.text
    boundary = created.json()
    assert boundary["type"] == "Feature"
    assert boundary["geometry"] == _polygon(_square(LOOP_BBOX))
    assert boundary["properties"]["name"] == "South-west"
    assert boundary["properties"]["import_area_id"] == area["id"]
    assert boundary["properties"]["created_at"]

    _create(client, area["id"], "All", _polygon(_square(LOOP_BBOX, 1.0)))
    url = f"/import-areas/{area['id']}/boundaries"
    assert client.get(f"{url}/{boundary['id']}").json() == boundary
    listed = client.get(url).json()
    assert listed["type"] == "FeatureCollection"
    assert [feature["properties"]["name"] for feature in listed["features"]] == ["All", "South-west"]

    deleted = client.delete(f"{url}/{boundary['id']}")
    assert deleted.status_code == 204
    missing = client.get(f"{url}/{boundary['id']}")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "boundary_not_found"
    assert [feature["properties"]["name"] for feature in client.get(url).json()["features"]] == ["All"]


def test_rectangle_and_counts_are_unchanged_by_create_and_delete(client):
    area = _import(client)
    before = client.get(f"/import-areas/{area['id']}").json()

    boundary = _create(client, area["id"]).json()
    after_create = client.get(f"/import-areas/{area['id']}").json()
    client.delete(f"/import-areas/{area['id']}/boundaries/{boundary['id']}")
    after_delete = client.get(f"/import-areas/{area['id']}").json()

    assert before == after_create == after_delete
    assert before["bbox"] == LOOP_BBOX


def _bow_tie(bbox):
    ring = _square(bbox)
    # Swap two corners: south-west, north-east, south-east, north-west.
    return [ring[0], ring[2], ring[1], ring[3], ring[0]]


@pytest.mark.parametrize(
    ("geometry", "rule"),
    [
        (_polygon(_bow_tie(LOOP_BBOX)), "self_intersecting"),
        (_polygon(_square({**LOOP_BBOX, "max_latitude": 9.9420}, 1.0)), "outside_import_area"),
        (_polygon(_square(LOOP_BBOX, 1.0), _square(LOOP_BBOX, 0.25)), "holes_not_supported"),
        ({"type": "Point", "coordinates": [-84.09, 9.94]}, "invalid_geojson"),
        ({"type": "Polygon", "coordinates": [[[-84.09], [-84.09, 9.94]]]}, "invalid_geojson"),
        ({"type": "Polygon", "coordinates": []}, "invalid_geojson"),
    ],
    ids=["self-intersecting", "outside-bbox", "holes", "not-a-polygon", "bad-position", "no-ring"],
)
def test_invalid_polygon_is_rejected_naming_the_rule(client, geometry, rule):
    area = _import(client)

    response = _create(client, area["id"], geometry=geometry)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_boundary"
    assert error["details"] == {"rule": rule}
    assert client.get(f"/import-areas/{area['id']}/boundaries").json()["features"] == []


def test_out_of_range_coordinate_is_rejected(client):
    area = _import(client)
    ring = _square(LOOP_BBOX)
    ring[1] = [-184.0, ring[1][1]]

    response = _create(client, area["id"], geometry=_polygon(ring))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_coordinate"


def test_duplicate_name_is_a_conflict(client):
    area = _import(client)
    _create(client, area["id"])

    response = _create(client, area["id"], geometry=_polygon(_square(LOOP_BBOX, 1.0)))

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "boundary_name_conflict"


def test_unknown_import_area(client):
    unknown = uuid.uuid4()

    for response in (_create(client, unknown), client.get(f"/import-areas/{unknown}/boundaries")):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "import_area_not_found"


def test_unknown_boundary_and_boundary_of_another_area(client):
    area = _import(client)
    other = _import(client, OTHER_BBOX)
    foreign = _create(client, other["id"], geometry=_polygon(_square(OTHER_BBOX))).json()

    for boundary_id in (uuid.uuid4(), foreign["id"]):
        url = f"/import-areas/{area['id']}/boundaries/{boundary_id}"
        for response in (client.get(url), client.delete(url)):
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "boundary_not_found"

    # The foreign boundary survived the cross-area delete attempt.
    assert client.get(f"/import-areas/{other['id']}/boundaries/{foreign['id']}").status_code == 200


def test_create_and_delete_commit_their_writes(client, db_session):
    # The test session only ever commits a SAVEPOINT, so a write the endpoint forgot to
    # commit would still be visible here. An open transaction afterwards is the tell.
    area = _import(client)
    assert not db_session.in_transaction()

    boundary = _create(client, area["id"]).json()
    assert not db_session.in_transaction(), "create left its write uncommitted"

    client.delete(f"/import-areas/{area['id']}/boundaries/{boundary['id']}")
    assert not db_session.in_transaction(), "delete left its write uncommitted"
