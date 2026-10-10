import pytest

from app.api.dependencies import get_elevation_source
from tests.api.elevation_stubs import DownSource, SlopedSource
from tests.api.test_background_import import (
    BBOX,
    InlineExecutor,
    NeverRunsExecutor,
    _events,
    _payload,
    _use_registry,
)

LAYERS = ("road_segments", "navigable_nodes", "blocks", "buildings", "pois", "area_features")


@pytest.fixture()
def inline(client, db_session):
    return _use_registry(client, db_session, InlineExecutor())


def _import(client) -> str:
    response = client.post("/import-areas", json={"bbox": BBOX, "payload": _payload()})
    assert response.status_code == 200
    return response.json()["id"]


def _entity_ids(client, area_id):
    map_data = client.get(f"/import-areas/{area_id}/map-data").json()
    return {layer: sorted(feature["id"] for feature in map_data[layer]["features"]) for layer in LAYERS}


def test_reanalysis_answers_202_then_streams_elevation_and_completed(client, inline):
    area_id = _import(client)
    client.app.dependency_overrides[get_elevation_source] = lambda: SlopedSource()

    response = client.post(f"/import-areas/{area_id}/elevation")

    assert response.status_code == 202
    assert response.json() == {"import_area_id": area_id, "events_url": f"/import-areas/{area_id}/events"}
    events = _events(client, area_id)
    assert [event["stage"] for event in events] == ["elevation", "completed"]
    elevation = events[0]["data"]["elevation"]
    assert events[0]["data"]["error"] is None and "projection" in events[0]["data"]
    assert len(elevation["grid"]["heights"]) == elevation["grid"]["rows"] * elevation["grid"]["cols"]
    assert events[1]["data"] == {"import_area_id": area_id, "version": 1, "changed": True}


def test_a_second_run_changes_nothing_and_keeps_the_version(client, inline):
    area_id = _import(client)
    client.app.dependency_overrides[get_elevation_source] = lambda: SlopedSource()
    client.post(f"/import-areas/{area_id}/elevation")

    client.post(f"/import-areas/{area_id}/elevation")

    completed = _events(client, area_id)[-1]
    assert completed["stage"] == "completed"
    assert completed["data"]["changed"] is False and completed["data"]["version"] == 1


def test_a_different_ground_bumps_the_version(client, inline):
    area_id = _import(client)
    client.app.dependency_overrides[get_elevation_source] = lambda: SlopedSource()
    client.post(f"/import-areas/{area_id}/elevation")
    client.app.dependency_overrides[get_elevation_source] = lambda: SlopedSource(slope=1.0)

    client.post(f"/import-areas/{area_id}/elevation")

    completed = _events(client, area_id)[-1]
    assert completed["data"]["changed"] is True and completed["data"]["version"] == 2


def test_reanalysis_changes_no_entity(client, inline):
    area_id = _import(client)
    before = _entity_ids(client, area_id)
    status_before = client.get(f"/import-areas/{area_id}").json()
    client.app.dependency_overrides[get_elevation_source] = lambda: SlopedSource()

    client.post(f"/import-areas/{area_id}/elevation")
    client.post(f"/import-areas/{area_id}/elevation")

    assert _entity_ids(client, area_id) == before
    assert client.get(f"/import-areas/{area_id}").json() == status_before


def test_an_unavailable_source_is_a_failed_event(client, inline):
    area_id = _import(client)
    client.app.dependency_overrides[get_elevation_source] = lambda: DownSource()

    assert client.post(f"/import-areas/{area_id}/elevation").status_code == 202

    events = _events(client, area_id)
    assert [event["stage"] for event in events] == ["failed"]
    assert events[0]["data"]["code"] == "elevation_unavailable"


def test_an_unknown_area_is_not_found(client, inline):
    client.app.dependency_overrides[get_elevation_source] = lambda: SlopedSource()

    response = client.post("/import-areas/00000000-0000-0000-0000-000000000000/elevation")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "import_area_not_found"


def test_an_area_that_is_not_completed_is_not_ready(client, db_session):
    # A background import whose job never runs leaves its new area pending.
    _use_registry(client, db_session, NeverRunsExecutor())
    pending = client.post("/import-areas", json={"bbox": BBOX, "payload": _payload(), "background": True})
    pending_id = pending.json()["import_area_id"]
    client.app.dependency_overrides[get_elevation_source] = lambda: SlopedSource()

    response = client.post(f"/import-areas/{pending_id}/elevation")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "import_area_not_ready"


def test_a_running_job_refuses_a_reanalysis(client, db_session):
    area_id = _import(client)
    _use_registry(client, db_session, NeverRunsExecutor())
    client.app.dependency_overrides[get_elevation_source] = lambda: SlopedSource()
    assert client.post(f"/import-areas/{area_id}/elevation").status_code == 202

    response = client.post(f"/import-areas/{area_id}/elevation")

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "import_in_progress"
    assert error["details"] == {"import_area_id": area_id, "events_url": f"/import-areas/{area_id}/events"}


def test_a_disabled_source_answers_503_and_starts_no_job(client, inline):
    area_id = _import(client)

    response = client.post(f"/import-areas/{area_id}/elevation")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "elevation_unavailable"
    assert client.get(f"/import-areas/{area_id}/events").status_code == 404
