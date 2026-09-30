"""Overpass-specific handling that runs before the provider-neutral OSM parsing."""

from __future__ import annotations

from typing import Any

from app.ingestion.osm_adapter import IngestionError


class IncompleteSourceResponse(IngestionError):
    """The source says it returned less than it was asked for, so reconciling against it would
    delete real entities."""


def ensure_complete(payload: dict[str, Any]) -> None:
    """Rejects a payload carrying an Overpass `remark`.

    Overpass reports a timeout or out-of-memory as HTTP 200 with valid JSON, whatever elements it
    got to, and a `remark` such as "runtime error: Query timed out …". Any remark is rejected, not
    just runtime errors: reconcile can't tell a partial response from a complete one."""
    remark = payload.get("remark") if isinstance(payload, dict) else None
    if remark:
        raise IncompleteSourceResponse(f"the source response is incomplete: {remark}")
