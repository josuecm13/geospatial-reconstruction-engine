import uuid
from dataclasses import dataclass
from datetime import datetime

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.geometry import Polygon

# Cross products below this (in degrees²) count as collinear. Floating-point noise for
# coordinates near ±100° and edges of ~100 m is about 3e-17; at this threshold, a vertex
# 1 m from its neighbour counts as collinear only within ~0.01 mm of the line.
_COLLINEAR_EPSILON = 1e-15


class InvalidTracedBoundary(ValueError):
    """`rule` names the check that failed, so a caller can report it without parsing the message."""

    def __init__(self, rule: str, message: str):
        self.rule = rule
        super().__init__(message)


@dataclass(frozen=True)
class TracedBoundary:
    """A named shape over an import area that narrows it for queries and exports.
    It is a view: nothing imported is removed or changed by it."""

    id: uuid.UUID | None
    import_area_id: uuid.UUID
    name: str
    polygon: Polygon
    created_at: datetime | None = None


def validate_traced_boundary(name: str, polygon: Polygon, bbox: BoundingBox) -> str:
    """Raises `InvalidTracedBoundary` for the first rule the boundary breaks, and returns the
    stripped name. Geometry is treated as planar on longitude/latitude, as PostGIS does for
    SRID 4326, which is accurate at the ≤ 1 km scale of an import area."""
    stripped = name.strip()
    if not stripped:
        raise InvalidTracedBoundary("blank_name", "boundary name must not be blank")
    if len(polygon) < 4:
        raise InvalidTracedBoundary(
            "too_few_vertices", f"a boundary ring needs at least 3 distinct vertices, got {len(polygon)} points"
        )
    if polygon[0] != polygon[-1]:
        raise InvalidTracedBoundary("not_closed", "a boundary ring must end at the vertex it starts from")

    points = [(point.longitude, point.latitude) for point in polygon]
    if any(points[i] == points[i + 1] for i in range(len(points) - 1)):
        raise InvalidTracedBoundary("degenerate", "a boundary ring must not repeat a vertex consecutively")
    if all(_orientation(points[0], points[1], point) == 0 for point in points[2:]):
        raise InvalidTracedBoundary("degenerate", "a boundary must enclose a non-zero area")
    if _self_intersects(points):
        raise InvalidTracedBoundary("self_intersecting", "a boundary's edges must not cross or touch each other")

    outside = [point for point in polygon if not _within(point, bbox)]
    if outside:
        raise InvalidTracedBoundary(
            "outside_import_area",
            f"{len(outside)} vertices lie outside the import area's bounding box, "
            f"e.g. ({outside[0].latitude}, {outside[0].longitude})",
        )
    return stripped


def _within(point: Coordinate, bbox: BoundingBox) -> bool:
    # The bounding box is convex, so a ring whose vertices are all inside or on it is covered by it.
    return (
        bbox.min_corner.latitude <= point.latitude <= bbox.max_corner.latitude
        and bbox.min_corner.longitude <= point.longitude <= bbox.max_corner.longitude
    )


def _orientation(p, q, r) -> int:
    value = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    if abs(value) <= _COLLINEAR_EPSILON:
        return 0
    return 1 if value > 0 else -1


def _on_segment(p, q, r) -> bool:
    """Whether r, already known to be collinear with p and q, lies on the segment p–q."""
    return min(p[0], q[0]) <= r[0] <= max(p[0], q[0]) and min(p[1], q[1]) <= r[1] <= max(p[1], q[1])


def _segments_touch(a, b, c, d) -> bool:
    o1, o2, o3, o4 = _orientation(a, b, c), _orientation(a, b, d), _orientation(c, d, a), _orientation(c, d, b)
    if o1 != o2 and o3 != o4 and 0 not in (o1, o2, o3, o4):
        return True
    return (
        (o1 == 0 and _on_segment(a, b, c))
        or (o2 == 0 and _on_segment(a, b, d))
        or (o3 == 0 and _on_segment(c, d, a))
        or (o4 == 0 and _on_segment(c, d, b))
    )


def _self_intersects(points: list[tuple[float, float]]) -> bool:
    edges = list(zip(points, points[1:]))
    count = len(edges)
    for i in range(count):
        for j in range(i + 1, count):
            (a, b), (c, d) = edges[i], edges[j]
            if j == i + 1 or (i == 0 and j == count - 1):
                # Adjacent edges share one vertex. They are only wrong if they fold back onto
                # each other; continuing straight through a vertex is fine.
                shared, first_far, second_far = (b, a, d) if j == i + 1 else (a, b, c)
                if _orientation(first_far, shared, second_far) == 0 and (
                    _on_segment(first_far, shared, second_far) or _on_segment(shared, second_far, first_far)
                ):
                    return True
                continue
            if _segments_touch(a, b, c, d):
                return True
    return False
