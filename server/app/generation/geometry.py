"""Conversions between domain coordinates and shapely geometry in local metres.

Generation works in the metres of a `LocalProjection` (x east, y north), where distances, buffers
and areas mean what they say, and converts back to WGS84 only to store a result."""

from shapely.geometry import LineString as ShapelyLineString
from shapely.geometry import MultiPolygon as ShapelyMultiPolygon
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.geometry.base import BaseGeometry

from app.domain.bounding_box import Coordinate
from app.domain.geometry import LineString, MultiPolygon, Polygon
from app.domain.local_projection import LocalProjection


def to_local_xy(projection: LocalProjection, point: Coordinate) -> tuple[float, float]:
    return (
        (point.longitude - projection.origin.longitude) * projection.meters_per_degree_longitude,
        (point.latitude - projection.origin.latitude) * projection.meters_per_degree_latitude,
    )


def from_local_xy(projection: LocalProjection, x: float, y: float) -> Coordinate:
    return Coordinate(
        latitude=projection.origin.latitude + y / projection.meters_per_degree_latitude,
        longitude=projection.origin.longitude + x / projection.meters_per_degree_longitude,
    )


def polygon_to_local(projection: LocalProjection, ring: Polygon) -> ShapelyPolygon:
    return ShapelyPolygon([to_local_xy(projection, point) for point in ring])


def multipolygon_to_local(projection: LocalProjection, polygons: MultiPolygon) -> ShapelyMultiPolygon:
    return ShapelyMultiPolygon([polygon_to_local(projection, ring) for ring in polygons])


def linestring_to_local(projection: LocalProjection, line: LineString) -> ShapelyLineString:
    return ShapelyLineString([to_local_xy(projection, point) for point in line])


def polygon_from_local(projection: LocalProjection, polygon: ShapelyPolygon) -> Polygon:
    """The exterior ring (closed). The domain's polygons have no holes."""
    return tuple(from_local_xy(projection, x, y) for x, y in polygon.exterior.coords)


def polygons_of(geometry: BaseGeometry) -> list[ShapelyPolygon]:
    """Every non-empty polygon in a geometry, whatever its type: a Polygon, a MultiPolygon, or a
    collection that an overlay returned with stray lines and points, which are dropped."""
    if geometry.is_empty:
        return []
    if isinstance(geometry, ShapelyPolygon):
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [polygon for part in geometry.geoms for polygon in polygons_of(part)]
    return []


def as_multipolygon(geometry: BaseGeometry) -> ShapelyMultiPolygon:
    return ShapelyMultiPolygon(polygons_of(geometry))


def multipolygon_from_local(projection: LocalProjection, geometry: BaseGeometry) -> MultiPolygon:
    return tuple(polygon_from_local(projection, polygon) for polygon in polygons_of(geometry))
