import json
from pathlib import Path

import pytest

from app.ingestion.osm_adapter import OSMFixtureAdapter, OSMIngestionError
from app.ingestion.overpass import with_way_nodes_from_geometry

LIVE_FIXTURE = Path(__file__).parents[1] / "fixtures" / "overpass" / "rosenthaler_platz_small.json"


def _way(way_id, nodes, geometry, tags=None):
    return {"type": "way", "id": way_id, "nodes": nodes, "geometry": geometry, "tags": tags or {"highway": "residential"}}


def test_missing_way_nodes_are_added_from_inline_geometry():
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 1.0, "lon": 2.0},
            _way(10, [1, 2, 3], [{"lat": 9.0, "lon": 9.0}, {"lat": 1.5, "lon": 2.5}, {"lat": 1.6, "lon": 2.6}]),
            _way(11, [3, 4], [{"lat": 1.6, "lon": 2.6}, None]),
        ]
    }

    nodes = [(e["id"], e["lat"], e["lon"]) for e in with_way_nodes_from_geometry(payload)["elements"] if e["type"] == "node"]

    # The present node keeps its own coordinates, a shared node is added once, and a missing
    # geometry entry adds nothing.
    assert sorted(nodes) == [(1, 1.0, 2.0), (2, 1.5, 2.5), (3, 1.6, 2.6)]


def test_payload_without_inline_geometry_is_returned_unchanged():
    payload = {"elements": [{"type": "way", "id": 1, "nodes": [1, 2], "tags": {"highway": "residential"}}]}

    assert with_way_nodes_from_geometry(payload) is payload


def test_recorded_live_response_parses_only_with_geometry_nodes():
    payload = json.loads(LIVE_FIXTURE.read_text())

    with pytest.raises(OSMIngestionError, match="missing node"):
        OSMFixtureAdapter().parse(payload)
    records = OSMFixtureAdapter().parse(with_way_nodes_from_geometry(payload))

    assert len(records.roads) > 0 and len(records.buildings) > 0


import httpx

from app.domain.bounding_box import BoundingBox, Coordinate
from app.ingestion.overpass import (
    USER_AGENT,
    IncompleteSourceResponse,
    OverpassClient,
    UpstreamUnavailable,
    build_query,
)

BBOX = BoundingBox(Coordinate(52.5292, 13.4005), Coordinate(52.5302, 13.4021))
OK_BODY = {"version": 0.6, "osm3s": {}, "elements": []}


def _client(responses, sleeps=None):
    """An OverpassClient whose transport answers with `responses` in order and records requests."""
    requests = []
    queue = list(responses)

    def handler(request):
        requests.append(request)
        answer = queue.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    recorded = sleeps if sleeps is not None else []
    return OverpassClient(url="https://overpass.test/api/interpreter", transport=httpx.MockTransport(handler), sleep=recorded.append), requests


def test_query_is_south_west_north_east_and_asks_only_for_used_relations():
    query = build_query(BBOX)

    box = "52.5292,13.4005,52.5302,13.4021"
    assert query.startswith("[out:json][timeout:60];")
    assert f"node({box})->.inside;" in query and f"way({box})" in query
    assert f"rel({box})[type=multipolygon]" in query and "rel(bn.inside)[type=restriction]" in query
    assert "nwr(" not in query and query.endswith("out geom;")


def test_fetch_posts_the_query_with_an_identifying_user_agent():
    client, requests = _client([httpx.Response(200, json=OK_BODY)])

    assert client.fetch(BBOX) == OK_BODY
    (request,) = requests
    assert request.headers["User-Agent"] == USER_AGENT
    assert httpx.QueryParams(request.content.decode())["data"] == build_query(BBOX)


def test_queue_full_is_retried_after_retry_after():
    sleeps = []
    client, requests = _client([httpx.Response(429, headers={"Retry-After": "2"}), httpx.Response(200, json=OK_BODY)], sleeps)

    assert client.fetch(BBOX) == OK_BODY
    assert (len(requests), sleeps) == (2, [2.0])


def test_busy_on_every_attempt_is_upstream_unavailable_after_backing_off():
    sleeps = []
    client, requests = _client([httpx.Response(504, text="<html>too busy</html>")] * 3, sleeps)

    with pytest.raises(UpstreamUnavailable) as error:
        client.fetch(BBOX)

    assert (len(requests), sleeps, error.value.status) == (3, [5.0, 15.0], 504)


def test_a_non_retryable_error_is_not_retried():
    client, requests = _client([httpx.Response(400, text="parse error")] * 3)

    with pytest.raises(UpstreamUnavailable) as error:
        client.fetch(BBOX)

    assert (len(requests), error.value.status) == (1, 400)


@pytest.mark.parametrize(
    "answer",
    [httpx.ConnectError("refused"), httpx.ReadTimeout("slow")],
    ids=["unreachable", "timed out"],
)
def test_transport_failures_are_upstream_unavailable(answer):
    client, _ = _client([answer])

    with pytest.raises(UpstreamUnavailable):
        client.fetch(BBOX)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b'{"version":0.6,"elements":[{"type":"node","id":1,'),
        httpx.Response(200, json={**OK_BODY, "remark": "runtime error: Query timed out in \"query\" at line 1 after 3 seconds."}),
        httpx.Response(200, json=[]),
    ],
    ids=["truncated body", "remark", "not an object"],
)
def test_incomplete_answers_are_rejected(response):
    client, _ = _client([response])

    with pytest.raises(IncompleteSourceResponse):
        client.fetch(BBOX)
