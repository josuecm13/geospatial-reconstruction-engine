import json
import uuid
from pathlib import Path

from sqlalchemy import select

from app.persistence.models import ImportAreaModel

FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"
LOOP_FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_block_loop.json"

NEIGHBORHOOD_BBOX = {
    "min_latitude": 9.933, "min_longitude": -84.081, "max_latitude": 9.935, "max_longitude": -84.079,
}
LOOP_BBOX = {
    "min_latitude": 9.9398, "min_longitude": -84.0902, "max_latitude": 9.9407, "max_longitude": -84.0893,
}


def _import(client, bbox=None, fixture=FIXTURE):
    payload = json.loads(fixture.read_text())
    return client.post("/import-areas", json={"bbox": bbox or NEIGHBORHOOD_BBOX, "payload": payload})


def test_import_success_counts_including_blocks(client):
    response = _import(client, LOOP_BBOX, LOOP_FIXTURE)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["road_count"] == 4
    assert body["building_count"] == 1
    assert body["block_count"] == 1
    assert body["linked_building_count"] == 1


def test_import_is_idempotent(client):
    first = _import(client).json()
    second = _import(client).json()

    assert first["id"] == second["id"]
    assert first["building_count"] == second["building_count"]
    assert first["road_count"] == second["road_count"]


def test_invalid_bounding_box_creates_no_area(client, db_session):
    payload = json.loads(FIXTURE.read_text())
    bad_bbox = {"min_latitude": 9.935, "min_longitude": -84.081, "max_latitude": 9.933, "max_longitude": -84.079}

    response = client.post("/import-areas", json={"bbox": bad_bbox, "payload": payload})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_bounding_box"
    assert db_session.scalar(select(ImportAreaModel).limit(1)) is None


def test_malformed_payload_marks_area_failed(client, db_session):
    bad_payload = {"elements": [{"type": "way", "id": 1, "nodes": [10, 20], "tags": {"highway": "residential"}}]}

    response = client.post("/import-areas", json={"bbox": NEIGHBORHOOD_BBOX, "payload": bad_payload})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ingestion_failed"
    area = db_session.scalar(select(ImportAreaModel))
    assert area is not None
    assert area.status == "failed"


def test_payload_outside_bounding_box(client):
    payload = json.loads(FIXTURE.read_text())
    payload["elements"].append(
        {"type": "node", "id": 9001, "lat": 40.0, "lon": -3.0, "tags": {"amenity": "school", "name": "Far"}}
    )

    response = client.post("/import-areas", json={"bbox": NEIGHBORHOOD_BBOX, "payload": payload})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "payload_outside_bounding_box"
    assert error["details"] == {"source_ids": ["9001"]}


def test_payload_too_large_creates_no_area(client, db_session):
    huge_payload = {"elements": [], "padding": "x" * (17 * 1024 * 1024)}

    response = client.post("/import-areas", json={"bbox": NEIGHBORHOOD_BBOX, "payload": huge_payload})

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"
    assert db_session.scalar(select(ImportAreaModel).limit(1)) is None


def test_import_conflict_when_area_creation_races(client, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    from app.persistence.repositories.import_area import ImportAreaRepository

    def _boom(self, provider, bbox):
        raise IntegrityError("insert", {}, Exception("duplicate key"))

    monkeypatch.setattr(ImportAreaRepository, "get_or_create", _boom)

    response = _import(client)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "import_conflict"


def test_get_import_area_status_and_counts(client):
    created = _import(client).json()

    response = client.get(f"/import-areas/{created['id']}")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["building_count"] == created["building_count"]


def test_get_unknown_import_area(client):
    response = client.get(f"/import-areas/{uuid.uuid4()}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "import_area_not_found"


def test_map_data_not_ready_for_failed_area(client, db_session):
    bad_payload = {"elements": [{"type": "way", "id": 1, "nodes": [10, 20], "tags": {"highway": "residential"}}]}
    client.post("/import-areas", json={"bbox": NEIGHBORHOOD_BBOX, "payload": bad_payload})
    failed_area_id = db_session.scalar(select(ImportAreaModel.id))

    response = client.get(f"/import-areas/{failed_area_id}/map-data")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "import_area_not_ready"


def test_map_data_after_import_matches_counts_and_links_buildings(client):
    created = _import(client, LOOP_BBOX, LOOP_FIXTURE).json()

    response = client.get(f"/import-areas/{created['id']}/map-data")

    assert response.status_code == 200
    body = response.json()
    assert body["attribution"] == "© OpenStreetMap contributors"
    assert len(body["navigable_nodes"]["features"]) == created["node_count"]
    assert len(body["buildings"]["features"]) == created["building_count"]
    assert len(body["blocks"]["features"]) == created["block_count"]
    building = body["buildings"]["features"][0]
    assert building["properties"]["block_id"] == body["blocks"]["features"][0]["id"]
    # [lon, lat] ordering: the loop fixture's four corners are known exactly,
    # so a swapped-order bug (lat first) would produce a pair not in this set.
    expected_corners = {(-84.0900, 9.9400), (-84.0895, 9.9400), (-84.0895, 9.9405), (-84.0900, 9.9405)}
    segment = body["road_segments"]["features"][0]
    lon, lat = segment["geometry"]["coordinates"][0]
    assert (lon, lat) in expected_corners
    assert "street" in segment["properties"]
    raw = json.dumps(body)
    assert "highway" not in raw and "tags" not in raw


def test_map_data_segments_carry_the_generated_cross_section_and_its_provenance(client):
    created = _import(client).json()

    segments = client.get(f"/import-areas/{created['id']}/map-data").json()["road_segments"]["features"]

    by_street: dict[str | None, list[dict]] = {}
    for feature in segments:
        by_street.setdefault(feature["properties"]["street"]["name"], []).append(feature["properties"])
    # West Street is tagged lanes:forward=2 / lanes:backward=1: each direction keeps its tag.
    west = sorted((p["lane_count"], p["lane_count_provenance"], p["source_lane_count"]) for p in by_street["West Street"])
    assert west == [(1, "tagged", 1), (2, "tagged", 2)]
    assert {p["width_meters"] for p in by_street["West Street"]} == {3 * 3.25}
    # East Street has no lane tags: 1 + 1 defaulted, and the raw value stays unknown.
    for props in by_street["East Street"]:
        assert (props["lane_count"], props["lane_count_provenance"], props["source_lane_count"]) == (1, "defaulted", None)
        assert props["lane_type"] == "normal"
        assert props["width_meters"] == 2 * 3.25
    # The unnamed one-way is tagged lanes=1, in its travel direction only.
    (one_way,) = by_street[None]
    assert (one_way["lane_count"], one_way["lane_count_provenance"], one_way["width_meters"]) == (1, "tagged", 3.25)


def test_map_data_buildings_carry_source_height_and_levels(client):
    payload = json.loads(FIXTURE.read_text())
    payload["elements"].append(
        {"type": "way", "id": 901, "nodes": [11, 12, 13, 14, 11], "tags": {"building": "yes", "height": "9.5", "building:levels": "3"}}
    )
    created = client.post("/import-areas", json={"bbox": NEIGHBORHOOD_BBOX, "payload": payload}).json()

    buildings = client.get(f"/import-areas/{created['id']}/map-data").json()["buildings"]["features"]

    assert {(f["properties"]["height_meters"], f["properties"]["levels"]) for f in buildings} == {(None, None), (9.5, 3)}
