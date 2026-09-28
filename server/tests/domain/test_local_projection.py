import math

import pytest

from app.domain.bounding_box import Coordinate
from app.domain.geometry import EARTH_RADIUS_METERS, point_distance_meters
from app.domain.local_projection import local_projection_for


def ring(*lat_lon):
    return tuple(Coordinate(lat, lon) for lat, lon in lat_lon)


SQUARE = ring((9.933, -84.081), (9.933, -84.079), (9.935, -84.079), (9.935, -84.081), (9.933, -84.081))
# An "L": its centroid is not the centre of its bounding box.
L_SHAPE = ring((0.0, 0.0), (0.0, 0.002), (0.001, 0.002), (0.001, 0.001), (0.002, 0.001), (0.002, 0.0), (0.0, 0.0))


def test_origin_is_the_centroid_of_the_ring():
    assert local_projection_for(SQUARE).origin == Coordinate(9.934, -84.08)
    # Two 1×1 cells along the bottom and one on top of the left cell: centroid (5/6, 5/6) cells.
    origin = local_projection_for(L_SHAPE).origin
    assert origin.latitude == pytest.approx(0.002 * 5 / 12)
    assert origin.longitude == pytest.approx(0.002 * 5 / 12)


def test_origin_does_not_depend_on_where_the_ring_starts():
    rotated = SQUARE[2:-1] + SQUARE[:3]
    assert local_projection_for(rotated).origin == local_projection_for(SQUARE).origin


@pytest.mark.parametrize("latitude", [0.0, 9.934, 45.0, 60.0])
def test_factors_match_the_projects_own_distances(latitude):
    projection = local_projection_for(ring((latitude, 10.0), (latitude, 10.001), (latitude + 0.001, 10.0), (latitude, 10.0)))
    origin = projection.origin

    # One degree along each axis at the origin, measured with the distance used for distance_meters.
    north = point_distance_meters(origin, Coordinate(origin.latitude + 0.001, origin.longitude)) * 1000
    east = point_distance_meters(origin, Coordinate(origin.latitude, origin.longitude + 0.001)) * 1000

    assert projection.meters_per_degree_latitude == pytest.approx(north, rel=1e-6)
    assert projection.meters_per_degree_longitude == pytest.approx(east, rel=1e-6)
    assert projection.meters_per_degree_latitude == pytest.approx(math.pi * EARTH_RADIUS_METERS / 180)
