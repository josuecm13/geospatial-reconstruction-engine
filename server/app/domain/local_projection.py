import math
from dataclasses import dataclass

from app.domain.bounding_box import Coordinate
from app.domain.geometry import EARTH_RADIUS_METERS, Polygon

# Origins are rounded to this many decimal places (about 0.1 mm), so the same shape
# described from a different starting vertex gets exactly the same origin.
_ORIGIN_DECIMALS = 9


@dataclass(frozen=True)
class LocalProjection:
    """Places lon/lat in meters around `origin` for a Cartesian renderer:
    x = (lon - origin.lon) * meters_per_degree_longitude,
    y = (lat - origin.lat) * meters_per_degree_latitude.
    Accurate at the ≤ 1 km scale of an import area."""

    origin: Coordinate
    meters_per_degree_latitude: float
    meters_per_degree_longitude: float


def local_projection_for(ring: Polygon) -> LocalProjection:
    """The projection centred on the ring's centroid. Factors are on the same sphere as
    `app.domain.geometry`'s distances, so a length measured in the projection matches a
    segment's `distance_meters`."""
    origin = _centroid(ring)
    meters_per_degree = math.pi * EARTH_RADIUS_METERS / 180
    return LocalProjection(
        origin=origin,
        meters_per_degree_latitude=meters_per_degree,
        meters_per_degree_longitude=meters_per_degree * math.cos(math.radians(origin.latitude)),
    )


def _centroid(ring: Polygon) -> Coordinate:
    # Area-weighted planar centroid, relative to the first vertex to keep the products small.
    x0, y0 = ring[0].longitude, ring[0].latitude
    twice_area = cx = cy = 0.0
    for a, b in zip(ring, ring[1:]):
        ax, ay, bx, by = a.longitude - x0, a.latitude - y0, b.longitude - x0, b.latitude - y0
        cross = ax * by - bx * ay
        twice_area += cross
        cx += (ax + bx) * cross
        cy += (ay + by) * cross
    return Coordinate(
        latitude=round(y0 + cy / (3 * twice_area), _ORIGIN_DECIMALS),
        longitude=round(x0 + cx / (3 * twice_area), _ORIGIN_DECIMALS),
    )
