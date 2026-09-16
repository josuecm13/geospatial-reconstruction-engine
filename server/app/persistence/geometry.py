from geoalchemy2.elements import WKBElement
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import LineString as ShapelyLineString
from shapely.geometry import Point as ShapelyPoint
from shapely.geometry import Polygon as ShapelyPolygon

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.geometry import LineString, Polygon

SRID = 4326


def point_to_geom(point: Coordinate) -> WKBElement:
    return from_shape(ShapelyPoint(point.longitude, point.latitude), srid=SRID)


def geom_to_point(geom: WKBElement) -> Coordinate:
    shape = to_shape(geom)
    return Coordinate(latitude=shape.y, longitude=shape.x)


def linestring_to_geom(points: LineString) -> WKBElement:
    return from_shape(
        ShapelyLineString([(p.longitude, p.latitude) for p in points]), srid=SRID
    )


def geom_to_linestring(geom: WKBElement) -> LineString:
    shape = to_shape(geom)
    return tuple(Coordinate(latitude=y, longitude=x) for x, y in shape.coords)


def polygon_to_geom(ring: Polygon) -> WKBElement:
    return from_shape(ShapelyPolygon([(p.longitude, p.latitude) for p in ring]), srid=SRID)


def geom_to_polygon(geom: WKBElement) -> Polygon:
    shape = to_shape(geom)
    return tuple(Coordinate(latitude=y, longitude=x) for x, y in shape.exterior.coords)


def bbox_to_geom(bbox: BoundingBox) -> WKBElement:
    min_c, max_c = bbox.min_corner, bbox.max_corner
    ring = ShapelyPolygon(
        [
            (min_c.longitude, min_c.latitude),
            (max_c.longitude, min_c.latitude),
            (max_c.longitude, max_c.latitude),
            (min_c.longitude, max_c.latitude),
            (min_c.longitude, min_c.latitude),
        ]
    )
    return from_shape(ring, srid=SRID)
