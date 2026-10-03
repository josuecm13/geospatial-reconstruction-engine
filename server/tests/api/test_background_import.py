import json
from concurrent.futures import Executor, Future
from contextlib import nullcontext
from pathlib import Path

import pytest

from app.api.dependencies import get_import_jobs, get_job_session_scope, get_overpass_client
from app.ingestion.jobs import ImportJobRegistry
from app.ingestion.overpass import UpstreamUnavailable
from app.persistence.block_derivation import BlockDerivationService

FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"
BBOX = {"min_latitude": 9.933, "min_longitude": -84.081, "max_latitude": 9.935, "max_longitude": -84.079}
STAGES_BEFORE_BUILDINGS = ["fetched", "ground", "roads", "blocks"]


class InlineExecutor(Executor):
    """Runs a job's work inside `submit`, so a test sees a finished job and nothing races."""

    def submit(self, fn, /, *args, **kwargs):
        future = Future()
        fn(*args, **kwargs)
        future.set_result(None)
        return future


class NeverRunsExecutor(Executor):
    """Accepts work and never runs it: a job that stays running."""

    def submit(self, fn, /, *args, **kwargs):
        return Future()


def _use_registry(client, db_session, executor):
    registry = ImportJobRegistry(executor=executor)
    client.app.dependency_overrides[get_import_jobs] = lambda: registry
    # The job's own session is the test's savepoint session, and the test owns closing it.
    client.app.dependency_overrides[get_job_session_scope] = lambda: lambda: nullcontext(db_session)
    return registry


@pytest.fixture()
def inline(client, db_session):
    return _use_registry(client, db_session, InlineExecutor())


def _payload(extra_buildings=()):
    payload = json.loads(FIXTURE.read_text())
    for way_id, (lat, lon) in enumerate(extra_buildings, start=6001):
        node_ids = []
        for corner, (dlat, dlon) in enumerate([(0, 0), (0, 0.0001), (0.0001, 0.0001), (0.0001, 0)]):
            node_id = way_id * 10 + corner
            payload["elements"].append({"type": "node", "id": node_id, "lat": lat + dlat, "lon": lon + dlon})
            node_ids.append(node_id)
        payload["elements"].append({"type": "way", "id": way_id, "nodes": [*node_ids, node_ids[0]], "tags": {"building": "yes"}})
    return payload


def _start(client, payload):
    return client.post("/import-areas", json={"bbox": BBOX, "payload": payload, "background": True})


def _events(client, area_id, last_event_id=None):
    response = client.get(f"/import-areas/{area_id}/events", headers={"Last-Event-ID": str(last_event_id)} if last_event_id else {})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = []
    for block in filter(None, response.text.split("\n\n")):
        fields = dict(line.split(": ", 1) for line in block.split("\n"))
        events.append({"id": int(fields["id"]), "stage": fields["event"], "data": json.loads(fields["data"])})
    return events


def test_background_import_answers_202_and_streams_the_stages_in_order(client, inline):
    response = _start(client, _payload())

    assert response.status_code == 202
    area_id = response.json()["import_area_id"]
    assert response.json()["events_url"] == f"/import-areas/{area_id}/events"
    events = _events(client, area_id)
    stages = [event["stage"] for event in events]
    assert stages[:4] == STAGES_BEFORE_BUILDINGS
    assert stages[4:-1] and set(stages[4:-1]) == {"buildings"}
    assert stages[-1] == "completed"
    assert [event["id"] for event in events] == list(range(1, len(events) + 1))
    assert all("projection" in event["data"] for event in events[:-1])
    assert events[0]["data"]["element_count"] == len(_payload()["elements"])
    assert events[-1]["data"]["status"] == "completed"
    assert events[-1]["data"]["id"] == area_id


def test_each_stage_carries_its_features(client, inline):
    area_id = _start(client, _payload()).json()["import_area_id"]

    by_stage = {event["stage"]: event["data"] for event in _events(client, area_id)}

    assert len(by_stage["ground"]["area_features"]["features"]) == 1
    assert len(by_stage["ground"]["pois"]["features"]) == 1
    segments = by_stage["roads"]["road_segments"]["features"]
    assert len(segments) == 5
    assert "lane_count" in segments[0]["properties"]
    assert by_stage["blocks"]["blocks"]["features"] == []


def test_building_rings_cover_the_areas_buildings_once_nearest_first(client, inline):
    # The rectangle's centre is (9.934, -84.080); the second building is ~125 m away, in ring 1.
    payload = _payload(extra_buildings=[(9.93395, -84.08005), (9.9348, -84.0808)])
    area_id = _start(client, payload).json()["import_area_id"]

    batches = [event["data"] for event in _events(client, area_id) if event["stage"] == "buildings"]

    streamed = [feature["id"] for batch in batches for feature in batch["buildings"]["features"]]
    stored = [feature["id"] for feature in client.get(f"/import-areas/{area_id}/map-data").json()["buildings"]["features"]]
    assert len(streamed) == len(set(streamed)) == 3
    assert sorted(streamed) == sorted(stored)
    rings = [batch["ring"] for batch in batches]
    assert rings == sorted(rings) and len(rings) >= 2


def test_reconnecting_with_last_event_id_replays_only_what_follows(client, inline):
    area_id = _start(client, _payload()).json()["import_area_id"]
    everything = _events(client, area_id)

    resumed = _events(client, area_id, last_event_id=2)

    assert resumed == everything[2:]
    assert resumed[0]["id"] == 3


def _snapshot(client, area_id):
    """The area and its map data, with features in a fixed order: the API doesn't promise one."""
    map_data = client.get(f"/import-areas/{area_id}/map-data").json()
    for layer in ("road_segments", "navigable_nodes", "blocks", "buildings", "pois", "area_features"):
        map_data[layer]["features"].sort(key=lambda feature: feature["id"])
    return client.get(f"/import-areas/{area_id}").json(), map_data


def test_a_failure_in_a_late_stage_leaves_the_previous_import_untouched(client, inline, monkeypatch):
    first = client.post("/import-areas", json={"bbox": BBOX, "payload": _payload(extra_buildings=[(9.93395, -84.08005)])})
    assert first.status_code == 200
    area_id = first.json()["id"]
    before = _snapshot(client, area_id)

    def fail(self, import_area_id):
        raise RuntimeError("block derivation blew up")

    monkeypatch.setattr(BlockDerivationService, "derive_for_import_area", fail)
    # Without the extra building, a successful reconcile would delete it.
    assert _start(client, _payload()).status_code == 202
    events = _events(client, area_id)

    assert events[-1]["stage"] == "failed"
    assert events[-1]["data"]["code"] == "ingestion_failed"
    assert "block derivation blew up" in events[-1]["data"]["message"]
    assert "completed" not in [event["stage"] for event in events]
    after = _snapshot(client, area_id)
    assert after == before
    assert after[0]["status"] == "completed"


def test_a_failed_fetch_becomes_a_failed_event_with_the_same_code(client, db_session):
    _use_registry(client, db_session, InlineExecutor())

    class Unreachable:
        def fetch(self, bbox):
            raise UpstreamUnavailable("overpass is down", status=504)

    client.app.dependency_overrides[get_overpass_client] = Unreachable

    area_id = client.post("/import-areas", json={"bbox": BBOX, "background": True}).json()["import_area_id"]
    events = _events(client, area_id)

    assert [event["stage"] for event in events] == ["failed"]
    assert events[0]["data"]["code"] == "upstream_unavailable"
    assert events[0]["data"]["details"] == {"upstream_status": 504}
    # A brand-new area stays pending with no data.
    assert client.get(f"/import-areas/{area_id}").json()["status"] == "pending"


def test_a_second_import_of_a_running_area_is_refused(client, db_session):
    _use_registry(client, db_session, NeverRunsExecutor())
    started = _start(client, _payload())
    area_id = started.json()["import_area_id"]

    background = _start(client, _payload())
    synchronous = client.post("/import-areas", json={"bbox": BBOX, "payload": _payload()})

    for refused in (background, synchronous):
        assert refused.status_code == 409
        error = refused.json()["error"]
        assert error["code"] == "import_in_progress"
        assert error["details"] == {"import_area_id": area_id, "events_url": f"/import-areas/{area_id}/events"}


def test_an_invalid_rectangle_is_refused_before_anything_starts(client, inline):
    response = client.post(
        "/import-areas",
        json={"bbox": {**BBOX, "max_latitude": 12.0}, "payload": _payload(), "background": True},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_bounding_box"


def test_events_for_an_area_with_no_job_are_not_found(client, inline):
    area_id = client.post("/import-areas", json={"bbox": BBOX, "payload": _payload()}).json()["id"]

    response = client.get(f"/import-areas/{area_id}/events")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "import_job_not_found"


def test_events_for_an_unknown_area_are_not_found(client, inline):
    response = client.get("/import-areas/00000000-0000-0000-0000-000000000000/events")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "import_area_not_found"
