import httpx

from app.ingestion.geocoder import NominatimGeocoder
from app.ingestion.overpass import USER_AGENT


def _geocoder(handler):
    return NominatimGeocoder(url="https://nominatim.test/", transport=httpx.MockTransport(handler))


def test_reverse_asks_for_the_point_and_names_it():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"address": {"suburb": "Mitte", "city": "Berlin", "country": "Germany"}})

    assert _geocoder(handler).reverse(52.53, 13.4) == ("Mitte", "Berlin, Germany")

    (request,) = seen
    assert request.url.path == "/reverse"
    params = dict(request.url.params)
    assert params["format"] == "jsonv2" and params["zoom"] == "14" and params["addressdetails"] == "1"
    assert params["lat"] == "52.53" and params["lon"] == "13.4" and params["accept-language"] == "en"
    assert request.headers["user-agent"] == USER_AGENT


def test_a_non_200_answer_is_no_name():
    assert _geocoder(lambda request: httpx.Response(429)).reverse(0.0, 0.0) == (None, None)


def test_bad_json_is_no_name():
    assert _geocoder(lambda request: httpx.Response(200, content=b"<html>")).reverse(0.0, 0.0) == (None, None)


def test_a_reply_without_an_address_is_no_name():
    assert _geocoder(lambda request: httpx.Response(200, json={"error": "Unable to geocode"})).reverse(0.0, 0.0) == (
        None,
        None,
    )


def test_a_timeout_is_no_name():
    def handler(request):
        raise httpx.ConnectTimeout("slow", request=request)

    assert _geocoder(handler).reverse(0.0, 0.0) == (None, None)


def test_a_transport_error_is_no_name():
    def handler(request):
        raise httpx.ConnectError("down", request=request)

    assert _geocoder(handler).reverse(0.0, 0.0) == (None, None)
