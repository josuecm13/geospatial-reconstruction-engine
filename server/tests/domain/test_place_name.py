import pytest

from app.domain.place_name import place_from_address

CASES = [
    pytest.param(
        {"neighbourhood": "Rosenthaler Vorstadt", "suburb": "Mitte", "city": "Berlin", "state": "Berlin", "country": "Germany"},
        ("Rosenthaler Vorstadt", "Berlin, Germany"),
        id="berlin-mitte-prefers-the-most-local-name",
    ),
    pytest.param(
        {"suburb": "Mitte", "city": "Berlin", "country": "Germany"},
        ("Mitte", "Berlin, Germany"),
        id="suburb-when-no-neighbourhood",
    ),
    pytest.param(
        {"village": "Sarchi", "county": "Valverde Vega", "state": "Alajuela", "country": "Costa Rica"},
        ("Sarchi", "Valverde Vega, Costa Rica"),
        id="village",
    ),
    pytest.param(
        {"city": "Berlin", "state": "Berlin", "country": "Germany"},
        ("Berlin", "Germany"),
        id="name-equal-to-city-skips-it-in-the-context",
    ),
    pytest.param({"country": "Germany"}, (None, "Germany"), id="only-a-country"),
    pytest.param({}, (None, None), id="empty-address-ocean"),
    pytest.param(None, (None, None), id="no-address"),
    pytest.param({"suburb": "  ", "city": "Lyon", "country": ""}, ("Lyon", None), id="blank-values-are-absent"),
]


@pytest.mark.parametrize("address, expected", CASES)
def test_place_from_address(address, expected):
    assert place_from_address(address) == expected
