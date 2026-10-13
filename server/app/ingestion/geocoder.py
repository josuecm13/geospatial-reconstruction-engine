"""Reverse geocoding for an import area's place name (Nominatim).

A name is a nicety, never a requirement: every failure ends in (None, None), so an import is
never held up or failed by the geocoder.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass

import httpx

from app.domain.place_name import place_from_address
from app.ingestion.overpass import USER_AGENT

logger = logging.getLogger(__name__)

DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org"
TIMEOUT_SECONDS = 3.0

# Nominatim's usage policy: at most one request a second. A search that would wait longer than
# MAX_WAIT_SECONDS for its slot is refused rather than queued behind a pile of others.
MIN_INTERVAL_SECONDS = 1.0
MAX_WAIT_SECONDS = 5.0
CACHE_SIZE = 256
CACHE_TTL_SECONDS = 24 * 60 * 60
# A result without a bounding box (a point) is framed by this many degrees around it (about 1 km).
POINT_HALF_SPAN_DEGREES = 0.005


class GeocoderUnavailable(Exception):
    """A place search could not be answered: the geocoder failed, refused, or answered nonsense."""


@dataclass(frozen=True)
class PlaceResult:
    display_name: str
    name: str
    latitude: float
    longitude: float
    south: float
    west: float
    north: float
    east: float
    category: str | None
    type: str | None


_state_lock = threading.Lock()
_next_slot = 0.0
_cache: OrderedDict[tuple[str, str, int], tuple[float, list[PlaceResult]]] = OrderedDict()


def reset_search_state() -> None:
    """Forgets the cache and the rate limiter's clock (tests)."""
    global _next_slot
    with _state_lock:
        _next_slot = 0.0
        _cache.clear()


def _normalize(query: str) -> str:
    return " ".join(query.lower().split())


def _cached(key: tuple[str, str, int]) -> list[PlaceResult] | None:
    with _state_lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        stored_at, results = entry
        if time.monotonic() - stored_at > CACHE_TTL_SECONDS:
            del _cache[key]
            return None
        _cache.move_to_end(key)
        return list(results)


def _remember(key: tuple[str, str, int], results: list[PlaceResult]) -> None:
    with _state_lock:
        _cache[key] = (time.monotonic(), list(results))
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)


def _wait_for_slot() -> None:
    """Reserves the next request slot, process-wide, and sleeps until it comes."""
    global _next_slot
    with _state_lock:
        now = time.monotonic()
        slot = max(now, _next_slot)
        if slot - now > MAX_WAIT_SECONDS:
            raise GeocoderUnavailable("the geocoder is busy; try again shortly")
        _next_slot = slot + MIN_INTERVAL_SECONDS
    if slot > now:
        time.sleep(slot - now)


def _parse_result(raw: object) -> PlaceResult | None:
    if not isinstance(raw, dict):
        return None
    try:
        latitude, longitude = float(raw["lat"]), float(raw["lon"])
        display = str(raw.get("display_name") or "")
        box = raw.get("boundingbox")
        if isinstance(box, list) and len(box) == 4:
            south, north, west, east = (float(v) for v in box)
        else:
            south, north = latitude - POINT_HALF_SPAN_DEGREES, latitude + POINT_HALF_SPAN_DEGREES
            west, east = longitude - POINT_HALF_SPAN_DEGREES, longitude + POINT_HALF_SPAN_DEGREES
    except (KeyError, TypeError, ValueError):
        return None
    if not display:
        return None
    name = str(raw.get("name") or "") or display.split(",")[0].strip()
    category = raw.get("category") or raw.get("class")
    kind = raw.get("type")
    return PlaceResult(
        display_name=display,
        name=name,
        latitude=latitude,
        longitude=longitude,
        south=south,
        west=west,
        north=north,
        east=east,
        category=str(category) if category else None,
        type=str(kind) if kind else None,
    )


class NominatimGeocoder:
    def __init__(self, url: str = DEFAULT_GEOCODER_URL, transport: httpx.BaseTransport | None = None):
        self.url = url.rstrip("/")
        self.transport = transport

    def reverse(self, latitude: float, longitude: float) -> tuple[str | None, str | None]:
        """The (place name, context) at a point, or (None, None). Never raises."""
        params = {
            "format": "jsonv2",
            "lat": latitude,
            "lon": longitude,
            "zoom": 14,
            "addressdetails": 1,
            "accept-language": "en",
        }
        try:
            with httpx.Client(
                transport=self.transport, timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}
            ) as client:
                response = client.get(f"{self.url}/reverse", params=params)
            if response.status_code != 200:
                logger.warning("reverse geocoding answered HTTP %s", response.status_code)
                return None, None
            address = response.json().get("address")
            return place_from_address(address if isinstance(address, dict) else None)
        except Exception as exc:  # a name is optional: nothing here may fail an import
            logger.warning("reverse geocoding failed: %s", exc)
            return None, None

    def search(self, query: str, limit: int = 5) -> list[PlaceResult]:
        """Places matching a free-text query, best first. Unlike `reverse`, a failure raises
        `GeocoderUnavailable`, so the caller can tell "nothing found" from "could not ask"."""
        key = (self.url, _normalize(query), limit)
        hit = _cached(key)
        if hit is not None:
            return hit
        _wait_for_slot()
        params = {"format": "jsonv2", "q": query, "limit": limit, "accept-language": "en"}
        try:
            with httpx.Client(
                transport=self.transport, timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}
            ) as client:
                response = client.get(f"{self.url}/search", params=params)
            if response.status_code != 200:
                raise GeocoderUnavailable(f"the geocoder answered HTTP {response.status_code}")
            body = response.json()
        except GeocoderUnavailable:
            raise
        except Exception as exc:
            logger.warning("place search failed: %s", exc)
            raise GeocoderUnavailable("the geocoder could not be reached") from exc
        if not isinstance(body, list):
            raise GeocoderUnavailable("the geocoder answered something unexpected")
        results = [parsed for parsed in map(_parse_result, body) if parsed is not None]
        _remember(key, results)
        return results
