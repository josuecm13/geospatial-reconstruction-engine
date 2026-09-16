import pytest

from app.domain.bounding_box import BoundingBox, Coordinate, InvalidBoundingBox


def test_valid_bounding_box_is_accepted():
    box = BoundingBox(
        min_corner=Coordinate(30.0, -97.8),
        max_corner=Coordinate(30.005, -97.795),
    )
    assert box.area_square_meters() <= 1_000_000.0


def test_latitude_out_of_range_is_rejected():
    with pytest.raises(InvalidBoundingBox):
        Coordinate(91.0, 0.0)


def test_longitude_out_of_range_is_rejected():
    with pytest.raises(InvalidBoundingBox):
        Coordinate(0.0, -181.0)


def test_inverted_min_max_latitude_is_rejected():
    with pytest.raises(InvalidBoundingBox):
        BoundingBox(
            min_corner=Coordinate(30.01, -97.8),
            max_corner=Coordinate(30.0, -97.79),
        )


def test_inverted_min_max_longitude_is_rejected():
    with pytest.raises(InvalidBoundingBox):
        BoundingBox(
            min_corner=Coordinate(30.0, -97.79),
            max_corner=Coordinate(30.01, -97.8),
        )


def test_bounding_box_within_limit_is_accepted():
    box = BoundingBox(
        min_corner=Coordinate(30.0, -97.8),
        max_corner=Coordinate(30.009, -97.791),
    )
    assert box.area_square_meters() <= 1_000_000.0


def test_oversized_bounding_box_is_rejected():
    with pytest.raises(InvalidBoundingBox):
        BoundingBox(
            min_corner=Coordinate(30.0, -97.9),
            max_corner=Coordinate(30.1, -97.8),
        )
