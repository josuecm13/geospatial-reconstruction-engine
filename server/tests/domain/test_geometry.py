from app.domain.bounding_box import Coordinate
from app.domain.geometry import linestring_length_meters


def test_one_hundredth_degree_of_latitude_is_about_1113_meters():
    # 0.01 degree of latitude is ~1,113 m regardless of longitude (meridians converge only
    # in the east-west direction), a standard reference value for sanity-checking geodesic math.
    points = (Coordinate(30.0, -97.8), Coordinate(30.01, -97.8))

    length = linestring_length_meters(points)

    assert 1100 < length < 1125


def test_length_of_multi_point_line_is_sum_of_segments():
    points = (
        Coordinate(30.0, -97.8),
        Coordinate(30.005, -97.8),
        Coordinate(30.005, -97.795),
    )

    total = linestring_length_meters(points)
    leg_one = linestring_length_meters(points[0:2])
    leg_two = linestring_length_meters(points[1:3])

    assert total == leg_one + leg_two
