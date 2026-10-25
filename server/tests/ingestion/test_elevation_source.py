import io
import math

import httpx
import pytest
from PIL import Image

from app.domain.bounding_box import BoundingBox, Coordinate
from app.ingestion.elevation_source import ElevationUnavailable, TerrainTilesSource, tiles_for

URL = "https://terrain.test/{z}/{x}/{y}.png"
WORLD = 256 * 2**15
BASE_X, BASE_Y = 9649 * 256, 12314 * 256

# About 60 m by 55 m in Manhattan, inside zoom-15 tile 9649/12314.
BBOX = BoundingBox(Coordinate(40.7580, -73.9857), Coordinate(40.7585, -73.9850))


def terrarium_png(height_at_pixel) -> bytes:
    """A 256x256 terrarium tile; `height_at_pixel(column, row)` is in metres and must be a multiple of 1/256."""
    image = Image.new("RGB", (256, 256))
    pixels = []
    for row in range(256):
        for column in range(256):
            value = height_at_pixel(column, row) + 32768
            whole = math.floor(value)
            pixels.append((whole // 256, whole % 256, round((value - whole) * 256)))
    image.putdata(pixels)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def east_plane_tile(tile_x: int) -> bytes:
    # Rises a quarter metre per pixel eastward, measured from the first tile's west edge.
    return terrarium_png(lambda column, row: 0.25 * (tile_x * 256 + column - BASE_X))


def south_plane_tile(tile_y: int) -> bytes:
    return terrarium_png(lambda column, row: 0.25 * (tile_y * 256 + row - BASE_Y))


def source_for(handler, **options) -> TerrainTilesSource:
    options.setdefault("sleep", lambda seconds: None)
    return TerrainTilesSource(URL, transport=httpx.MockTransport(handler), **options)


def tile_of(request: httpx.Request) -> tuple[int, int]:
    z, x, y = request.url.path.removesuffix(".png").strip("/").split("/")
    assert z == "15"
    return int(x), int(y)


def pixel_x(longitude: float) -> float:
    return (longitude + 180) / 360 * WORLD


def pixel_y(latitude: float) -> float:
    radians = math.radians(latitude)
    return (1 - math.log(math.tan(radians) + 1 / math.cos(radians)) / math.pi) / 2 * WORLD


def test_tiles_for_a_box_inside_one_tile():
    # Independently: x = (lon + 180) / 360 * 2^15 = 9649.66, y = 12314.7 at this zoom.
    assert tiles_for(BBOX) == [(9649, 12314)]


def test_tiles_for_includes_every_tile_the_box_and_its_margin_touch():
    boundary_lon = 9650 * 256 / WORLD * 360 - 180
    across = BoundingBox(Coordinate(40.7580, boundary_lon - 0.0002), Coordinate(40.7585, boundary_lon + 0.0002))
    # This box ends a fraction of a pixel short of the edge: only the margin pulls the neighbour in.
    margin_only = BoundingBox(Coordinate(40.7580, boundary_lon - 0.0002), Coordinate(40.7585, boundary_lon - 0.000005))

    assert tiles_for(across) == [(9649, 12314), (9650, 12314)]
    assert tiles_for(margin_only) == [(9649, 12314), (9650, 12314)]


def test_grid_matches_a_plane_rising_east_across_two_tiles():
    boundary_lon = 9650 * 256 / WORLD * 360 - 180
    bbox = BoundingBox(Coordinate(40.7580, boundary_lon - 0.0002), Coordinate(40.7585, boundary_lon + 0.0002))
    requested = []

    def handler(request):
        requested.append(tile_of(request))
        return httpx.Response(200, content=east_plane_tile(tile_of(request)[0]))

    grid = source_for(handler).fetch_grid(bbox)

    assert sorted(requested) == [(9649, 12314), (9650, 12314)]
    assert grid.origin == bbox.min_corner
    assert grid.rows >= 2 and grid.cols >= 2
    for row in range(grid.rows):
        for col in range(grid.cols):
            longitude = bbox.min_corner.longitude + col * grid.lon_step
            assert grid.height_at(row, col) == pytest.approx(0.25 * (pixel_x(longitude) - 0.5 - BASE_X), abs=1e-6)
    assert grid.lat_step * (grid.rows - 1) == pytest.approx(0.0005)
    assert grid.lon_step * (grid.cols - 1) == pytest.approx(0.0004)


def test_row_zero_is_the_south_edge():
    def handler(request):
        return httpx.Response(200, content=south_plane_tile(tile_of(request)[1]))

    grid = source_for(handler).fetch_grid(BBOX)

    for row in range(grid.rows):
        latitude = BBOX.min_corner.latitude + row * grid.lat_step
        assert grid.height_at(row, 0) == pytest.approx(0.25 * (pixel_y(latitude) - 0.5 - BASE_Y), abs=1e-6)
    # South is further down the pixel grid, so it is higher on this plane.
    assert grid.height_at(0, 0) > grid.height_at(grid.rows - 1, 0)


def test_a_throttled_tile_is_retried_after_the_backoff():
    calls, sleeps = [], []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(429)
        return httpx.Response(200, content=east_plane_tile(9649))

    grid = source_for(handler, sleep=sleeps.append, backoff_seconds=(2.0, 4.0)).fetch_grid(BBOX)

    assert len(calls) == 2
    assert sleeps == [2.0]
    assert grid.height_at(0, 0) == pytest.approx(0.25 * (pixel_x(BBOX.min_corner.longitude) - 0.5 - BASE_X), abs=1e-6)


def test_retry_after_is_honoured():
    calls, sleeps = [], []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(503, headers={"Retry-After": "7"})
        return httpx.Response(200, content=east_plane_tile(9649))

    source_for(handler, sleep=sleeps.append).fetch_grid(BBOX)

    assert sleeps == [7.0]


def test_exhausted_retries_raise_elevation_unavailable():
    calls, sleeps = [], []

    def handler(request):
        calls.append(request)
        return httpx.Response(503)

    with pytest.raises(ElevationUnavailable, match="busy"):
        source_for(handler, sleep=sleeps.append, backoff_seconds=(1.0, 2.0)).fetch_grid(BBOX)

    assert len(calls) == 3
    assert sleeps == [1.0, 2.0]


def test_a_client_error_is_not_retried():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(403)

    with pytest.raises(ElevationUnavailable, match="403"):
        source_for(handler).fetch_grid(BBOX)

    assert len(calls) == 1


def test_a_transport_error_and_a_timeout_raise_elevation_unavailable():
    def unreachable(request):
        raise httpx.ConnectError("no route", request=request)

    def slow(request):
        raise httpx.ReadTimeout("too slow", request=request)

    with pytest.raises(ElevationUnavailable, match="reached"):
        source_for(unreachable).fetch_grid(BBOX)
    with pytest.raises(ElevationUnavailable, match="in time"):
        source_for(slow).fetch_grid(BBOX)


def test_an_unreadable_tile_raises_elevation_unavailable():
    with pytest.raises(ElevationUnavailable, match="image"):
        source_for(lambda request: httpx.Response(200, content=b"not a png")).fetch_grid(BBOX)


def test_a_missing_tile_counts_as_sea_level():
    grid = source_for(lambda request: httpx.Response(404)).fetch_grid(BBOX)

    assert set(grid.heights) == {0.0}


def test_decoded_tiles_are_cached_between_grids():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, content=east_plane_tile(9649))

    source = source_for(handler)
    first = source.fetch_grid(BBOX)
    second = source.fetch_grid(BBOX)

    assert len(calls) == 1
    assert first == second
    assert calls[0].headers["User-Agent"].startswith("geospatial-reconstruction-engine/")


def test_a_void_pixel_in_a_tile_does_not_become_a_pit():
    void_x, void_y = int(pixel_x(-73.98535)) - BASE_X, int(pixel_y(40.75825)) - BASE_Y
    png = terrarium_png(lambda column, row: -300.0 if (column, row) == (void_x, void_y) else 5.0)
    grid = source_for(lambda request: httpx.Response(200, content=png)).fetch_grid(BBOX)

    assert min(grid.heights) == pytest.approx(5.0)
    assert max(grid.heights) == pytest.approx(5.0)
