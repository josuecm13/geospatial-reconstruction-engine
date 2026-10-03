"""Nested import areas: what a new import skips because a completed inner area already holds it,
and how an outer area's own features compose with its inner areas' on read.

An inner area is a completed import area whose bounding box is covered by the new one's. It owns
the buildings, POIs, area features, and interior blocks inside it; the outer area stores only what
lies outside every inner area (or crosses an inner edge), plus the whole road network.
"""

from collections.abc import Callable, Iterable, Sequence
from typing import TypeVar

from app.domain.bounding_box import BoundingBox, Coordinate

T = TypeVar("T")


def is_covered_by(points: Iterable[Coordinate], box: BoundingBox) -> bool:
    """Whether every point lies inside the box or on its edge. A box is convex, so a polygon or
    line is covered by it exactly when its vertices are. No points cover nothing: False."""
    seen = False
    for point in points:
        seen = True
        if not (
            box.min_corner.latitude <= point.latitude <= box.max_corner.latitude
            and box.min_corner.longitude <= point.longitude <= box.max_corner.longitude
        ):
            return False
    return seen


def is_covered_by_any(points: Iterable[Coordinate], boxes: Sequence[BoundingBox]) -> bool:
    points = tuple(points)
    return any(is_covered_by(points, box) for box in boxes)


def without_covered(
    items: Iterable[T], points_of: Callable[[T], Iterable[Coordinate]], boxes: Sequence[BoundingBox]
) -> tuple[list[T], list[T]]:
    """Splits `items` into those to keep and those covered by one of `boxes`, both in input order."""
    kept: list[T] = []
    covered: list[T] = []
    for item in items:
        (covered if boxes and is_covered_by_any(points_of(item), boxes) else kept).append(item)
    return kept, covered


def compose_by_source_id(layers: Iterable[Iterable[T]], source_id: Callable[[T], str]) -> list[T]:
    """One layer from several areas' layers, in order: the first copy of a source id wins, so the
    outer area's own features (listed first) take precedence over an inner area's copy."""
    seen: set[str] = set()
    result: list[T] = []
    for layer in layers:
        for item in layer:
            key = source_id(item)
            if key not in seen:
                seen.add(key)
                result.append(item)
    return result
