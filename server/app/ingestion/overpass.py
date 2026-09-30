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
