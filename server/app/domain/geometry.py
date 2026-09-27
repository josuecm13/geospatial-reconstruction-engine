import math

from app.domain.bounding_box import Coordinate
from app.domain.enums import MovementKind

LineString = tuple[Coordinate, ...]
Polygon = tuple[Coordinate, ...]
MultiPolygon = tuple[Polygon, ...]

EARTH_RADIUS_METERS = 6_371_000.0


def _haversine_meters(a: Coordinate, b: Coordinate) -> float:
    lat1, lon1, lat2, lon2 = map(
        math.radians, (a.latitude, a.longitude, b.latitude, b.longitude)
    )
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(h))


def linestring_length_meters(points: LineString) -> float:
    return sum(_haversine_meters(points[i], points[i + 1]) for i in range(len(points) - 1))


def point_distance_meters(a: Coordinate, b: Coordinate) -> float:
    """Public entry point for a single two-point distance (e.g. a route's snap distance)."""
    return _haversine_meters(a, b)


def bearing_degrees(a: Coordinate, b: Coordinate) -> float:
    lat1, lon1, lat2, lon2 = map(
        math.radians, (a.latitude, a.longitude, b.latitude, b.longitude)
    )
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def classify_turn(incoming_bearing: float, outgoing_bearing: float) -> MovementKind:
    diff = (outgoing_bearing - incoming_bearing + 180) % 360 - 180
    if -45 <= diff <= 45:
        return MovementKind.STRAIGHT
    if 45 < diff < 135:
        return MovementKind.RIGHT
    if -135 < diff < -45:
        return MovementKind.LEFT
    return MovementKind.U_TURN
