import json
from pathlib import Path

from sqlalchemy import func, select

from app.api.dependencies import get_overpass_client
from app.ingestion.overpass import IncompleteSourceResponse, UpstreamUnavailable
from app.persistence.models import ImportAreaModel

LIVE_FIXTURE = Path(__file__).parents[1] / "fixtures" / "overpass" / "live_query_rosenthaler_small.json"
LIVE_BBOX = {"min_latitude": 52.5292, "min_longitude": 13.4005, "max_latitude": 52.5302, "max_longitude": 13.4021}


class RecordedOverpass:
    """Answers every fetch with a recorded response (or raises), and records the boxes asked for."""

    def __init__(self, answer):
        self.answer = answer
        self.boxes = []

    def fetch(self, bbox):
        self.boxes.append(bbox)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def _use(client, overpass):
    client.app.dependency_overrides[get_overpass_client] = lambda: overpass
    return overpass


def test_import_without_payload_fetches_the_box_and_imports_it(client):
    overpass = _use(client, RecordedOverpass(json.loads(LIVE_FIXTURE.read_text())))

    response = client.post("/import-areas", json={"bbox": LIVE_BBOX})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["road_count"] > 0 and body["building_count"] > 0 and body["block_count"] > 0
    (bbox,) = overpass.boxes
    assert (bbox.min_corner.latitude, bbox.min_corner.longitude, bbox.max_corner.latitude, bbox.max_corner.longitude) == (
        52.5292, 13.4005, 52.5302, 13.4021,
    )
    map_data = client.get(f"/import-areas/{body['id']}/map-data").json()
    assert len(map_data["buildings"]["features"]) == body["building_count"]


def test_posted_payload_is_imported_without_fetching(client):
    overpass = _use(client, RecordedOverpass(AssertionError("must not fetch")))

    response = client.post("/import-areas", json={"bbox": LIVE_BBOX, "payload": json.loads(LIVE_FIXTURE.read_text())})

    assert response.status_code == 200
    assert overpass.boxes == []


def test_unavailable_overpass_is_503_and_creates_no_area(client, db_session):
    _use(client, RecordedOverpass(UpstreamUnavailable("Overpass is busy (HTTP 504) after 3 attempts", 504)))

    response = client.post("/import-areas", json={"bbox": LIVE_BBOX})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_unavailable"
    assert response.json()["error"]["details"] == {"upstream_status": 504}
    assert db_session.scalar(select(func.count()).select_from(ImportAreaModel)) == 0


def test_incomplete_live_response_is_502_and_leaves_the_area_as_it_was(client):
    _use(client, RecordedOverpass(json.loads(LIVE_FIXTURE.read_text())))
    created = client.post("/import-areas", json={"bbox": LIVE_BBOX}).json()
    before = client.get(f"/import-areas/{created['id']}/map-data").json()
    _use(client, RecordedOverpass(IncompleteSourceResponse("the source response is truncated")))

    response = client.post("/import-areas", json={"bbox": LIVE_BBOX})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "source_incomplete"
    assert client.get(f"/import-areas/{created['id']}/map-data").json() == before


def test_invalid_bounding_box_is_rejected_before_fetching(client):
    overpass = _use(client, RecordedOverpass(AssertionError("must not fetch")))
    too_big = {"min_latitude": 52.50, "min_longitude": 13.40, "max_latitude": 52.52, "max_longitude": 13.42}

    response = client.post("/import-areas", json={"bbox": too_big})

    assert response.json()["error"]["code"] == "invalid_bounding_box"
    assert overpass.boxes == []


def test_the_default_test_client_never_reaches_overpass(client):
    # conftest's NoNetworkOverpass is what keeps CI off the network: without an override, a live
    # import fails instead of calling out.
    response = client.post("/import-areas", json={"bbox": LIVE_BBOX})

    assert response.status_code == 500
