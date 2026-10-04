"""Reverse geocoding for an import area's place name (Nominatim).

A name is a nicety, never a requirement: every failure ends in (None, None), so an import is
never held up or failed by the geocoder.
"""

from __future__ import annotations

import logging

import httpx

from app.domain.place_name import place_from_address
from app.ingestion.overpass import USER_AGENT

logger = logging.getLogger(__name__)

DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org"
TIMEOUT_SECONDS = 3.0


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
