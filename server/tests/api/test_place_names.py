import json
from contextlib import nullcontext
from pathlib import Path

import pytest

from app.api.dependencies import get_geocoder, get_import_jobs, get_job_session_scope
from app.ingestion.jobs import ImportJobRegistry
from tests.api.test_background_import import InlineExecutor
from tests.api.test_import_areas import NEIGHBORHOOD_BBOX

FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"


class FakeGeocoder:
    def __init__(self, answer=("Mitte", "Berlin, Germany")):
        self.answer = answer
        self.points = []

    def reverse(self, latitude, longitude):
        self.points.append((latitude, longitude))
        return self.answer


def _import(client, **extra):
    payload = json.loads(FIXTURE.read_text())
    return client.post("/import-areas", json={"bbox": NEIGHBORHOOD_BBOX, "payload": payload, **extra})


def test_import_response_carries_the_place_found_at_the_box_centre(client):
    geocoder = FakeGeocoder()
    client.app.dependency_overrides[get_geocoder] = lambda: geocoder

    body = _import(client).json()

    assert (body["place_name"], body["place_context"]) == ("Mitte", "Berlin, Germany")
    (point,) = geocoder.points
    assert point == pytest.approx((9.934, -84.08))
    area = client.get(f"/import-areas/{body['id']}").json()
    assert (area["place_name"], area["place_context"]) == ("Mitte", "Berlin, Germany")
    assert client.get("/import-areas").json()["import_areas"][0]["place_name"] == "Mitte"


def test_without_a_geocoder_the_place_is_null(client):
    body = _import(client).json()

    assert body["place_name"] is None and body["place_context"] is None


def test_a_failed_lookup_keeps_the_earlier_name(client):
    client.app.dependency_overrides[get_geocoder] = lambda: FakeGeocoder()
    _import(client)
    client.app.dependency_overrides[get_geocoder] = lambda: FakeGeocoder((None, None))

    body = _import(client).json()

    assert body["place_name"] == "Mitte"


def test_a_reimport_overwrites_the_name(client):
    client.app.dependency_overrides[get_geocoder] = lambda: FakeGeocoder()
    _import(client)
    client.app.dependency_overrides[get_geocoder] = lambda: FakeGeocoder(("Neustadt", "Dresden, Germany"))

    body = _import(client).json()

    assert (body["place_name"], body["place_context"]) == ("Neustadt", "Dresden, Germany")


def test_the_completed_event_of_a_background_import_carries_the_place(client, db_session):
    registry = ImportJobRegistry(executor=InlineExecutor())
    client.app.dependency_overrides[get_import_jobs] = lambda: registry
    client.app.dependency_overrides[get_job_session_scope] = lambda: lambda: nullcontext(db_session)
    client.app.dependency_overrides[get_geocoder] = lambda: FakeGeocoder()

    started = _import(client, background=True).json()

    response = client.get(f"/import-areas/{started['import_area_id']}/events")
    blocks = [dict(line.split(": ", 1) for line in b.split("\n")) for b in filter(None, response.text.split("\n\n"))]
    completed = next(json.loads(b["data"]) for b in blocks if b["event"] == "completed")
    assert (completed["place_name"], completed["place_context"]) == ("Mitte", "Berlin, Germany")


def _record_order(client, db_session, monkeypatch):
    """A geocoder and a commit wrapper that log into one list, to see which came last."""
    events = []

    class RecordingGeocoder(FakeGeocoder):
        def reverse(self, latitude, longitude):
            events.append("lookup")
            return super().reverse(latitude, longitude)

    real_commit = db_session.commit

    def commit():
        events.append("commit")
        real_commit()

    monkeypatch.setattr(db_session, "commit", commit)
    client.app.dependency_overrides[get_geocoder] = lambda: RecordingGeocoder()
    return events


def test_the_place_is_committed_after_it_is_looked_up(client, db_session, monkeypatch):
    events = _record_order(client, db_session, monkeypatch)

    _import(client)

    assert "lookup" in events
    assert events[-1] == "commit" and events.index("lookup") < len(events) - 1


def test_the_place_of_a_background_import_is_committed_after_it_is_looked_up(client, db_session, monkeypatch):
    registry = ImportJobRegistry(executor=InlineExecutor())
    client.app.dependency_overrides[get_import_jobs] = lambda: registry
    client.app.dependency_overrides[get_job_session_scope] = lambda: lambda: nullcontext(db_session)
    events = _record_order(client, db_session, monkeypatch)

    _import(client, background=True)

    assert "lookup" in events
    assert events[-1] == "commit" and events.index("lookup") < len(events) - 1
