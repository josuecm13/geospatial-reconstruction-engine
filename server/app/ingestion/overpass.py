"""Overpass-specific handling that runs before the provider-neutral OSM parsing."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from typing import Any

import httpx

from app.domain.bounding_box import BoundingBox
from app.ingestion.osm_adapter import IngestionError

logger = logging.getLogger(__name__)

DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# The public instance refuses requests without an identifying User-Agent (HTTP 406).
USER_AGENT = "geospatial-reconstruction-engine/0.1 (+https://github.com/josuecm13/geospatial-reconstruction-engine)"
QUERY_TIMEOUT_SECONDS = 60
# Overpass's queue-full (429) and busy (504, sometimes 502/503) answers are worth retrying after a
# pause, sequentially: its fair-use policy expects one query at a time per client.
RETRYABLE_STATUSES = frozenset({429, 502, 503, 504})
BACKOFF_SECONDS = (5.0, 15.0)
MAX_RETRY_AFTER_SECONDS = 30.0


class IncompleteSourceResponse(IngestionError):
    """The source says it returned less than it was asked for, so reconciling against it would
    delete real entities."""


class UpstreamUnavailable(Exception):
    """Overpass couldn't be reached or didn't answer usefully; nothing was imported or changed."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def ensure_complete(payload: dict[str, Any]) -> None:
    """Rejects a payload carrying an Overpass `remark`.

    Overpass reports a timeout or out-of-memory as HTTP 200 with valid JSON, whatever elements it
    got to, and a `remark` such as "runtime error: Query timed out …". Any remark is rejected, not
    just runtime errors: reconcile can't tell a partial response from a complete one."""
    remark = payload.get("remark") if isinstance(payload, dict) else None
    if remark:
        raise IncompleteSourceResponse(f"the source response is incomplete: {remark}")


def with_way_nodes_from_geometry(payload: dict[str, Any]) -> dict[str, Any]:
    """Returns the payload with a node element for every way node that has none.

    With `out geom`, Overpass emits node elements only inside the query box, but gives each way an
    inline `geometry` array index-aligned with its `nodes`. The coordinates of the missing nodes are
    taken from there, so the provider-neutral parsing needs no Overpass knowledge. Node elements that
    are present are never replaced, and a payload without inline geometry is returned unchanged."""
    elements = payload.get("elements") if isinstance(payload, dict) else None
    if not isinstance(elements, list):
        return payload
    known = {str(element.get("id")) for element in elements if isinstance(element, dict) and element.get("type") == "node"}
    added: list[dict[str, Any]] = []
    for element in elements:
        if not isinstance(element, dict) or element.get("type") != "way":
            continue
        geometry = element.get("geometry")
        if not isinstance(geometry, list):
            continue
        for node_id, point in zip(element.get("nodes", []), geometry):
            if str(node_id) in known or not isinstance(point, dict) or "lat" not in point or "lon" not in point:
                continue
            added.append({"type": "node", "id": node_id, "lat": point["lat"], "lon": point["lon"]})
            known.add(str(node_id))
    if not added:
        return payload
    return {**payload, "elements": [*elements, *added]}


def build_query(bbox: BoundingBox, timeout_seconds: int = QUERY_TIMEOUT_SECONDS) -> str:
    """Nodes and ways in the box, multipolygons touching it, and the turn restrictions whose via
    node is inside it.

    Only the relation types the adapter reads are asked for: `nwr(bbox)` also returns every bus
    and tram route crossing the box with full geometry, many times the size of the rest.
    Restrictions are selected through their via node (`bn`), so their from/to ways, which meet at
    that node, are in the response too."""
    box = f"{bbox.min_corner.latitude},{bbox.min_corner.longitude},{bbox.max_corner.latitude},{bbox.max_corner.longitude}"
    return (
        f"[out:json][timeout:{timeout_seconds}];"
        f"node({box})->.inside;"
        f"(.inside;way({box});rel({box})[type=multipolygon];rel(bn.inside)[type=restriction];);"
        "out geom;"
    )


class OverpassClient:
    """Fetches one bounding box from an Overpass instance."""

    def __init__(
        self,
        url: str = DEFAULT_OVERPASS_URL,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        backoff_seconds: tuple[float, ...] = BACKOFF_SECONDS,
    ):
        self.url = url
        self.transport = transport
        self.sleep = sleep
        self.backoff_seconds = backoff_seconds

    def fetch(self, bbox: BoundingBox) -> dict[str, Any]:
        """Returns the complete response payload.

        Raises `UpstreamUnavailable` when Overpass can't be reached, keeps answering busy after
        every retry, or answers with an error; raises `IncompleteSourceResponse` when the body is
        truncated or carries a `remark`."""
        started = time.perf_counter()
        payload = self._fetch(bbox)
        logger.info(
            "overpass fetch took %.1f s: %d elements, %.1f km²",
            time.perf_counter() - started, len(payload.get("elements", [])), bbox.area_square_meters() / 1e6,
        )
        return payload

    def _fetch(self, bbox: BoundingBox) -> dict[str, Any]:
        query = build_query(bbox)
        # The server gives up at the query timeout; allow for queueing and transfer on top.
        timeout = httpx.Timeout(QUERY_TIMEOUT_SECONDS + 30.0, connect=10.0)
        with httpx.Client(transport=self.transport, timeout=timeout, headers={"User-Agent": USER_AGENT}) as client:
            for attempt in range(len(self.backoff_seconds) + 1):
                try:
                    response = client.post(self.url, data={"data": query})
                except httpx.TimeoutException as error:
                    raise UpstreamUnavailable("Overpass did not answer in time") from error
                except httpx.TransportError as error:
                    raise UpstreamUnavailable(f"Overpass could not be reached: {error}") from error
                if response.status_code == 200:
                    return self._complete_payload(response)
                if response.status_code not in RETRYABLE_STATUSES:
                    raise UpstreamUnavailable(f"Overpass answered HTTP {response.status_code}", response.status_code)
                if attempt < len(self.backoff_seconds):
                    self.sleep(self._retry_delay(response, self.backoff_seconds[attempt]))
            raise UpstreamUnavailable(
                f"Overpass is busy (HTTP {response.status_code}) after {len(self.backoff_seconds) + 1} attempts",
                response.status_code,
            )

    @staticmethod
    def _complete_payload(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = json.loads(response.content)
        except ValueError as error:
            # A 200 whose body isn't whole JSON was cut off in transfer.
            raise IncompleteSourceResponse("the source response is truncated") from error
        if not isinstance(payload, dict):
            raise IncompleteSourceResponse("the source response is not an Overpass JSON object")
        ensure_complete(payload)
        return payload

    @staticmethod
    def _retry_delay(response: httpx.Response, default: float) -> float:
        try:
            return min(float(response.headers["Retry-After"]), MAX_RETRY_AFTER_SECONDS)
        except (KeyError, ValueError):
            return default
