import pytest

from tests.api.test_background_import import BBOX, InlineExecutor, _payload, _start, _use_registry

GZIP = {"Accept-Encoding": "gzip"}
IDENTITY = {"Accept-Encoding": "identity"}


@pytest.fixture()
def area_id(client):
    response = client.post("/import-areas", json={"bbox": BBOX, "payload": _payload()})
    assert response.status_code == 200
    return response.json()["id"]


def test_map_data_is_gzipped_when_the_client_accepts_it(client, area_id):
    plain = client.get(f"/import-areas/{area_id}/map-data", headers=IDENTITY)
    compressed = client.get(f"/import-areas/{area_id}/map-data", headers=GZIP)
    # The test client decodes the body, but the header survives decoding.
    assert compressed.headers["content-encoding"] == "gzip"
    assert compressed.json() == plain.json()


def test_map_data_is_not_compressed_without_accept_encoding(client, area_id):
    response = client.get(f"/import-areas/{area_id}/map-data", headers=IDENTITY)
    assert "content-encoding" not in response.headers


def test_a_tiny_response_is_not_compressed(client):
    response = client.get("/health", headers=GZIP)
    assert response.status_code == 200
    assert "content-encoding" not in response.headers


def test_the_event_stream_is_never_compressed(client, db_session):
    _use_registry(client, db_session, InlineExecutor())
    area_id = _start(client, _payload()).json()["import_area_id"]
    response = client.get(f"/import-areas/{area_id}/events", headers=GZIP)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "content-encoding" not in response.headers
    assert "event: completed" in response.text
