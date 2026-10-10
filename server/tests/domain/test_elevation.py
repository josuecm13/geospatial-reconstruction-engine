import pytest

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.elevation import (
    ElevationGrid,
    building_base_height,
    grid_size_for,
    smoothed,
    vertex_heights,
)

ORIGIN = Coordinate(10.0, 20.0)
STEP = 0.001


FINE_STEP = 0.00003  # about 3.3 m between samples


def grid(rows, cols, height, step=STEP):
    return ElevationGrid(ORIGIN, step, step, rows, cols, tuple(height(r, c) for r in range(rows) for c in range(cols)))


def at(row, col):
    return Coordinate(ORIGIN.latitude + row * STEP, ORIGIN.longitude + col * STEP)


def test_the_shape_is_validated():
    with pytest.raises(ValueError):
        ElevationGrid(ORIGIN, STEP, STEP, 2, 2, (1.0, 2.0, 3.0))
    with pytest.raises(ValueError):
        ElevationGrid(ORIGIN, STEP, STEP, 1, 2, (1.0, 2.0))
    with pytest.raises(ValueError):
        ElevationGrid(ORIGIN, 0.0, STEP, 2, 2, (1.0,) * 4)


def test_height_at_is_row_major_from_the_south_west():
    g = grid(3, 4, lambda r, c: r * 10 + c)

    assert g.height_at(0, 0) == 0
    assert g.height_at(0, 3) == 3
    assert g.height_at(2, 1) == 21
    assert [(r, c) for r, c, _ in g.points()][:5] == [(0, 0), (0, 1), (0, 2), (0, 3), (1, 0)]


def test_sample_is_bilinear_and_exact_at_grid_points():
    g = grid(3, 3, lambda r, c: 2.0 * c + 10.0 * r)  # a plane

    assert g.sample(at(1, 2)) == pytest.approx(14.0)  # 2 * 2 + 10 * 1
    assert g.sample(Coordinate(10.0005, 20.0015)) == pytest.approx(0.5 * 10 + 1.5 * 2)
    # The mean of four corners that aren't a plane.
    saddle = ElevationGrid(ORIGIN, STEP, STEP, 2, 2, (0.0, 4.0, 8.0, 0.0))
    assert saddle.sample(Coordinate(10.0005, 20.0005)) == pytest.approx(3.0)


def test_sample_clamps_to_the_edges():
    g = grid(3, 3, lambda r, c: 2.0 * c + 10.0 * r)

    assert g.sample(Coordinate(9.0, 19.0)) == pytest.approx(0.0)
    assert g.sample(Coordinate(11.0, 21.0)) == pytest.approx(24.0)
    assert g.sample(Coordinate(10.001, 25.0)) == pytest.approx(14.0)
    assert not g.contains(Coordinate(9.0, 20.0))
    assert g.contains(at(2, 2))


def _bbox(lat_extent, lon_extent):
    return BoundingBox(Coordinate(40.0, -73.0), Coordinate(40.0 + lat_extent, -73.0 + lon_extent))


def test_grid_size_gives_about_five_meters_per_sample():
    rows, cols = grid_size_for(_bbox(0.0009, 0.0009))  # ~100 m north-south, ~76 m east-west at 40 N

    assert rows == pytest.approx(100 / 5 + 1, abs=1)
    assert cols == pytest.approx(76.5 / 5 + 1, abs=1)


def test_grid_size_is_clamped():
    assert grid_size_for(_bbox(0.000001, 0.000001)) == (2, 2)
    # A 1 km box is the largest an area can be: about 201 samples at 5 m on the long axis, so the default clamp never bites.
    rows, cols = grid_size_for(_bbox(0.009, 0.009))
    assert rows == 201
    assert 150 <= cols <= 156  # 1 km of latitude is about 767 m of longitude at 40 N
    assert grid_size_for(_bbox(0.009, 0.009), max_samples=40) == (40, 40)


def test_smoothing_preserves_a_constant_grid():
    result = smoothed(grid(30, 30, lambda r, c: 7.5, FINE_STEP), 30.0)

    assert result.heights == pytest.approx((7.5,) * 900)


def test_smoothing_flattens_a_spike_and_keeps_the_metadata():
    spike = grid(41, 41, lambda r, c: 100.0 if (r, c) == (20, 20) else 0.0, FINE_STEP)

    result = smoothed(spike, 30.0)

    assert result.height_at(20, 20) < 5.0
    assert result.height_at(20, 20) > 0.0
    assert (result.origin, result.lat_step, result.lon_step, result.rows, result.cols) == (ORIGIN, FINE_STEP, FINE_STEP, 41, 41)
    # A box blur conserves the total away from the edges.
    assert sum(result.heights) == pytest.approx(100.0)


def test_building_base_is_the_lowest_corner_on_a_slope():
    slope = grid(10, 10, lambda r, c: 50.0 - 2.0 * c)  # falls to the east
    footprint = (at(2.2, 3.2), at(2.2, 5.8), at(4.8, 5.8), at(4.8, 3.2), at(2.2, 3.2))

    assert building_base_height(slope, footprint) == pytest.approx(50.0 - 2.0 * 5.8)


def test_building_base_includes_an_interior_dip():
    dip = grid(10, 10, lambda r, c: -5.0 if (r, c) == (4, 4) else 10.0)
    footprint = (at(2.5, 2.5), at(2.5, 6.5), at(6.5, 6.5), at(6.5, 2.5), at(2.5, 2.5))

    assert building_base_height(dip, footprint) == -5.0
    outside = (at(0.2, 0.2), at(0.2, 1.8), at(1.8, 1.8), at(1.8, 0.2), at(0.2, 0.2))
    assert building_base_height(dip, outside) == 10.0


def test_vertex_heights_sample_each_vertex_in_order():
    g = grid(3, 3, lambda r, c: 2.0 * c + 10.0 * r)

    assert vertex_heights(g, (at(0, 0), at(1, 1), at(2, 2), Coordinate(10.0005, 20.0))) == pytest.approx((0.0, 12.0, 24.0, 5.0))
