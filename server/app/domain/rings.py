"""Orders items into concentric rings around a centre, so a client can reveal them outward."""

import math
from collections.abc import Callable, Sequence
from typing import Any, TypeVar

from app.domain.bounding_box import Coordinate
from app.domain.geometry import EARTH_RADIUS_METERS, Polygon

T = TypeVar("T")

DEFAULT_RING_WIDTH_METERS = 100.0


def mean_vertex(polygon: Polygon) -> Coordinate:
    """The mean of a polygon's vertices (the closing duplicate counted once): a cheap centre for
    a building footprint."""
    points = list(polygon)
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    return Coordinate(
        latitude=sum(point.latitude for point in points) / len(points),
        longitude=sum(point.longitude for point in points) / len(points),
    )


def ring_batches(
    items: Sequence[T],
    center: Coordinate,
    position: Callable[[T], Coordinate],
    ring_width_meters: float = DEFAULT_RING_WIDTH_METERS,
    tie_break: Callable[[T], Any] = lambda item: 0,
) -> list[list[T]]:
    """Each non-empty ring of `ring_width_meters` around `center`, nearest ring first.

    An item belongs to ring `floor(distance / width)`. Within a ring, items are ordered by distance,
    then by `tie_break`, so the result is deterministic. Distance is equirectangular, on the same
    sphere as the local projection (accurate at the ≤ 1 km of an import area).
    """
    meters_per_degree = math.pi * EARTH_RADIUS_METERS / 180
    longitude_scale = meters_per_degree * math.cos(math.radians(center.latitude))

    def distance(item: T) -> float:
        point = position(item)
        return math.hypot(
            (point.longitude - center.longitude) * longitude_scale,
            (point.latitude - center.latitude) * meters_per_degree,
        )

    rings: dict[int, list[tuple[float, Any, T]]] = {}
    for item in items:
        item_distance = distance(item)
        rings.setdefault(int(item_distance // ring_width_meters), []).append((item_distance, tie_break(item), item))
    return [[item for _, _, item in sorted(rings[ring], key=lambda entry: entry[:2])] for ring in sorted(rings)]
