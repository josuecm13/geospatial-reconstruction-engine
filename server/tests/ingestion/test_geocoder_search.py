import httpx
import pytest

from app.ingestion import geocoder as geocoder_module
from app.ingestion.geocoder import GeocoderUnavailable, NominatimGeocoder
from app.ingestion.overpass import USER_AGENT

BERLIN = {
    "name": "Berlin",
    "display_name": "Berlin, Germany",
    "lat": "52.5170365",
    "lon": "13.3888599",
    "boundingbox": ["52.3382448", "52.6755087", "13.0883450", "13.7611609"],
    "category": "boundary",
    "type": "administrative",
}


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    geocoder_module.reset_search_state()
    monkeypatch.setattr(geocoder_module.time, "sleep", lambda seconds: None)
    yield
    geocoder_module.reset_search_state()


def _geocoder(handler):
    return NominatimGeocoder(url="https://nominatim.test/", transport=httpx.MockTransport(handler))


def test_search_asks_nominatim_and_parses_the_results():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=[BERLIN])

    (place,) = _geocoder(handler).search("Berlin", limit=3)

    (request,) = seen
    assert request.url.path == "/search"
    params = dict(request.url.params)
    assert params["q"] == "Berlin" and params["format"] == "jsonv2" and params["limit"] == "3"
    assert request.headers["user-agent"] == USER_AGENT
    assert (place.name, place.display_name, place.category, place.type) == ("Berlin", "Berlin, Germany", "boundary", "administrative")
    assert (place.south, place.north, place.west, place.east) == (52.3382448, 52.6755087, 13.088345, 13.7611609)
    assert (place.latitude, place.longitude) == (52.5170365, 13.3888599)


def test_a_result_without_a_box_is_framed_around_its_point_and_named_from_its_display_name():
    raw = {"display_name": "Cafe Uno, Main St, Town", "lat": "10", "lon": "20"}

    (place,) = _geocoder(lambda request: httpx.Response(200, json=[raw])).search("cafe uno")

    assert place.name == "Cafe Uno"
    assert place.south < 10 < place.north and place.west < 20 < place.east


def test_malformed_entries_are_skipped_and_no_match_is_an_empty_list():
    body = [BERLIN, {"display_name": "No coordinates"}, "junk"]
    assert len(_geocoder(lambda request: httpx.Response(200, json=body)).search("berlin")) == 1
    assert _geocoder(lambda request: httpx.Response(200, json=[])).search("zzzz") == []


def test_the_same_query_is_answered_from_the_cache():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=[BERLIN])

    geocoder = _geocoder(handler)
    geocoder.search("Berlin")
    geocoder.search("  berlin ")

    assert len(calls) == 1


def test_a_different_limit_is_a_different_query():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=[BERLIN])

    geocoder = _geocoder(handler)
    geocoder.search("Berlin", 5)
    geocoder.search("Berlin", 3)

    assert len(calls) == 2


def test_failures_are_not_cached_and_raise():
    answers = iter([httpx.Response(500), httpx.Response(200, json=[BERLIN])])
    geocoder = _geocoder(lambda request: next(answers))

    with pytest.raises(GeocoderUnavailable):
        geocoder.search("Berlin")
    assert len(geocoder.search("Berlin")) == 1


@pytest.mark.parametrize(
    "response",
    [httpx.Response(429), httpx.Response(200, content=b"<html>"), httpx.Response(200, json={"error": "x"})],
)
def test_a_bad_answer_raises(response):
    with pytest.raises(GeocoderUnavailable):
        _geocoder(lambda request: response).search("Berlin")


def test_a_network_error_raises():
    def handler(request):
        raise httpx.ConnectError("down")

    with pytest.raises(GeocoderUnavailable):
        _geocoder(handler).search("Berlin")


def test_requests_are_spaced_a_second_apart(monkeypatch):
    sleeps = []
    monkeypatch.setattr(geocoder_module.time, "monotonic", lambda: 100.0)
    monkeypatch.setattr(geocoder_module.time, "sleep", sleeps.append)
    geocoder = _geocoder(lambda request: httpx.Response(200, json=[]))

    geocoder.search("one")
    geocoder.search("two")
    geocoder.search("three")

    assert sleeps == [pytest.approx(1.0), pytest.approx(2.0)]


def test_a_long_queue_is_refused_not_waited_out(monkeypatch):
    monkeypatch.setattr(geocoder_module.time, "monotonic", lambda: 100.0)
    geocoder = _geocoder(lambda request: httpx.Response(200, json=[]))

    with pytest.raises(GeocoderUnavailable):
        for i in range(10):
            geocoder.search(f"query {i}")
