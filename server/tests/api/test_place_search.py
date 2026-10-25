import pytest

from app.api.dependencies import get_geocoder
from app.ingestion.geocoder import GeocoderUnavailable, PlaceResult


class FakeGeocoder:
    def __init__(self, results=None, error=None):
        self.results = results or []
        self.error = error
        self.calls = []

    def search(self, query, limit=5):
        self.calls.append((query, limit))
        if self.error:
            raise self.error
        return self.results


PLACE = PlaceResult("Berlin, Germany", "Berlin", 52.5, 13.4, 52.3, 13.1, 52.7, 13.8, "boundary", "administrative")


def test_search_returns_places_with_a_bbox(client):
    geocoder = FakeGeocoder([PLACE])
    client.app.dependency_overrides[get_geocoder] = lambda: geocoder

    response = client.get("/places/search", params={"q": "  Berlin ", "limit": 3})

    assert response.status_code == 200
    assert response.json() == {
        "places": [
            {
                "display_name": "Berlin, Germany",
                "name": "Berlin",
                "latitude": 52.5,
                "longitude": 13.4,
                "bbox": {"south": 52.3, "west": 13.1, "north": 52.7, "east": 13.8},
                "category": "boundary",
                "type": "administrative",
            }
        ]
    }
    assert geocoder.calls == [("Berlin", 3)]


def test_no_match_is_an_empty_list(client):
    client.app.dependency_overrides[get_geocoder] = lambda: FakeGeocoder([])

    assert client.get("/places/search", params={"q": "zzzz"}).json() == {"places": []}


@pytest.mark.parametrize(
    "params",
    [{}, {"q": "a"}, {"q": "   a   "}, {"q": "x" * 201}, {"q": "ok", "limit": 0}, {"q": "ok", "limit": 11}],
)
def test_invalid_parameters_are_invalid_request(client, params):
    geocoder = FakeGeocoder([PLACE])
    client.app.dependency_overrides[get_geocoder] = lambda: geocoder

    response = client.get("/places/search", params=params)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert geocoder.calls == []


def test_an_upstream_failure_is_geocoder_unavailable(client):
    client.app.dependency_overrides[get_geocoder] = lambda: FakeGeocoder(error=GeocoderUnavailable("down"))

    response = client.get("/places/search", params={"q": "Berlin"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "geocoder_unavailable"


def test_a_disabled_geocoder_is_geocoder_unavailable(client):
    response = client.get("/places/search", params={"q": "Berlin"})  # the conftest default is None

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "geocoder_unavailable"
