"""Turning a geocoder's address into the place name an import area is shown under."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

NAME_KEYS = (
    "neighbourhood",
    "quarter",
    "suburb",
    "city_district",
    "borough",
    "village",
    "town",
    "city",
    "municipality",
    "county",
)
CONTEXT_KEYS = ("city", "town", "village", "municipality", "county", "state")


def _present(address: Mapping[str, Any], key: str) -> str | None:
    value = address.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def place_from_address(address: Mapping[str, Any] | None) -> tuple[str | None, str | None]:
    """The (name, context) of a Nominatim `address` object: the most local place it names, and
    the larger place and country around it. Either is None when the address doesn't say."""
    if not address:
        return None, None
    name = next((value for key in NAME_KEYS if (value := _present(address, key))), None)
    parts = []
    enclosing = next(
        (value for key in CONTEXT_KEYS if (value := _present(address, key)) and value != name), None
    )
    if enclosing is not None:
        parts.append(enclosing)
    country = _present(address, "country")
    if country is not None and country != name:
        parts.append(country)
    return name, ", ".join(parts) or None
