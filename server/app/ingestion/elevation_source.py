"""Reads ground heights from AWS Terrain Tiles ("terrarium" PNGs) into an `ElevationGrid`."""

from __future__ import annotations

import io
import logging
import math
import time
from collections import OrderedDict
from collections.abc import Callable

import httpx
from PIL import Image, UnidentifiedImageError

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.elevation import ElevationGrid, despike, grid_size_for
from app.ingestion.overpass import USER_AGENT

logger = logging.getLogger(__name__)

DEFAULT_TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 15  # the highest zoom the tiles are published at
TILE_SIZE = 256
REQUEST_TIMEOUT_SECONDS = 20.0
# Throttling (429) and server trouble are worth a short pause and another try.
RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})
BACKOFF_SECONDS = (1.0, 3.0)
MAX_RETRY_AFTER_SECONDS = 30.0
TILE_CACHE_SIZE = 256
# Web Mercator is undefined at the poles; the tiles stop at this latitude.
MAX_MERCATOR_LATITUDE = 85.05112878

Tile = tuple[float, ...]  # TILE_SIZE * TILE_SIZE heights, row-major from the tile's north-west pixel
_ZERO_TILE: Tile = (0.0,) * (TILE_SIZE * TILE_SIZE)


class ElevationUnavailable(Exception):
    """The terrain tiles couldn't be reached or didn't answer usefully; no grid was produced."""


def _world_pixels() -> int:
    return TILE_SIZE * 2**ZOOM


def pixel_of(point: Coordinate) -> tuple[float, float]:
    """The point's position in the zoom-15 world pixel grid (x east, y south), Web Mercator."""
    latitude = min(max(point.latitude, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE)
    sine = math.sin(math.radians(latitude))
    x = (point.longitude + 180.0) / 360.0
    y = 0.5 - math.log((1 + sine) / (1 - sine)) / (4 * math.pi)
    return x * _world_pixels(), y * _world_pixels()


def tiles_for(bbox: BoundingBox) -> list[tuple[int, int]]:
    """The (x, y) of every zoom-15 tile the box touches, plus a one-pixel margin, so bilinear
    sampling at the box's edges has all its neighbours."""
    corners = [pixel_of(bbox.min_corner), pixel_of(bbox.max_corner)]
    last = _world_pixels() - 1
    low_x = max(math.floor(min(x for x, _ in corners)) - 1, 0)
    high_x = min(math.floor(max(x for x, _ in corners)) + 1, last)
    low_y = max(math.floor(min(y for _, y in corners)) - 1, 0)
    high_y = min(math.floor(max(y for _, y in corners)) + 1, last)
    return [
        (tile_x, tile_y)
        for tile_y in range(low_y // TILE_SIZE, high_y // TILE_SIZE + 1)
        for tile_x in range(low_x // TILE_SIZE, high_x // TILE_SIZE + 1)
    ]


def decode_terrarium(png: bytes) -> Tile:
    """Heights in metres: `(R * 256 + G + B / 256) - 32768` for each pixel."""
    try:
        image = Image.open(io.BytesIO(png))
        image.load()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ElevationUnavailable("a terrain tile is not a readable image") from error
    if image.size != (TILE_SIZE, TILE_SIZE):
        raise ElevationUnavailable(f"a terrain tile is {image.size[0]}x{image.size[1]}, expected {TILE_SIZE}x{TILE_SIZE}")
    raw = image.convert("RGB").tobytes()
    return tuple(raw[i] * 256 + raw[i + 1] + raw[i + 2] / 256 - 32768 for i in range(0, len(raw), 3))


class TerrainTilesSource:
    """Fetches the terrain tiles under one bounding box and samples them onto a grid."""

    def __init__(
        self,
        url_template: str = DEFAULT_TERRAIN_URL,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        backoff_seconds: tuple[float, ...] = BACKOFF_SECONDS,
    ):
        self.url_template = url_template
        self.transport = transport
        self.sleep = sleep
        self.backoff_seconds = backoff_seconds
        # Decoded tiles, least recently used first, so a re-analysis or a neighbouring import
        # doesn't fetch them again. Keep one source per process to share it.
        self._tiles: OrderedDict[tuple[int, int], Tile] = OrderedDict()

    def fetch_grid(self, bbox: BoundingBox) -> ElevationGrid:
        """Heights above sea level on the grid `grid_size_for(bbox)` lays over the box.

        Raises `ElevationUnavailable` when a tile can't be fetched after the retries."""
        started = time.perf_counter()
        rows, cols = grid_size_for(bbox)
        south, west = bbox.min_corner.latitude, bbox.min_corner.longitude
        lat_step = (bbox.max_corner.latitude - south) / (rows - 1)
        lon_step = (bbox.max_corner.longitude - west) / (cols - 1)

        tiles = self._fetch_tiles(tiles_for(bbox))
        last = _world_pixels() - 1

        def pixel(x: int, y: int) -> float:
            x, y = min(max(x, 0), last), min(max(y, 0), last)
            return tiles[(x // TILE_SIZE, y // TILE_SIZE)][(y % TILE_SIZE) * TILE_SIZE + x % TILE_SIZE]

        heights: list[float] = []
        for row in range(rows):
            for col in range(cols):
                x, y = pixel_of(Coordinate(south + row * lat_step, west + col * lon_step))
                # Pixel (i, j) holds the height at its centre, (i + 0.5, j + 0.5).
                x, y = x - 0.5, y - 0.5
                x0, y0 = math.floor(x), math.floor(y)
                fx, fy = x - x0, y - y0
                upper = pixel(x0, y0) * (1 - fx) + pixel(x0 + 1, y0) * fx
                lower = pixel(x0, y0 + 1) * (1 - fx) + pixel(x0 + 1, y0 + 1) * fx
                heights.append(upper * (1 - fy) + lower * fy)

        logger.info("terrain fetch took %.1f s: %d tiles, %d x %d grid", time.perf_counter() - started, len(tiles), rows, cols)
        return ElevationGrid(
            origin=bbox.min_corner, lat_step=lat_step, lon_step=lon_step, rows=rows, cols=cols, heights=tuple(heights)
        )

    def _fetch_tiles(self, wanted: list[tuple[int, int]]) -> dict[tuple[int, int], Tile]:
        tiles: dict[tuple[int, int], Tile] = {}
        missing = [key for key in wanted if key not in self._tiles]
        for key in wanted:
            if key in self._tiles:
                self._tiles.move_to_end(key)
                tiles[key] = self._tiles[key]
        if missing:
            timeout = httpx.Timeout(REQUEST_TIMEOUT_SECONDS, connect=10.0)
            with httpx.Client(transport=self.transport, timeout=timeout, headers={"User-Agent": USER_AGENT}) as client:
                for key in missing:
                    tiles[key] = self._remember(key, self._fetch_tile(client, *key))
        return tiles

    def _remember(self, key: tuple[int, int], tile: Tile) -> Tile:
        self._tiles[key] = tile
        self._tiles.move_to_end(key)
        while len(self._tiles) > TILE_CACHE_SIZE:
            self._tiles.popitem(last=False)
        return tile

    def _fetch_tile(self, client: httpx.Client, x: int, y: int) -> Tile:
        url = self.url_template.format(z=ZOOM, x=x, y=y)
        for attempt in range(len(self.backoff_seconds) + 1):
            try:
                response = client.get(url)
            except httpx.TimeoutException as error:
                raise ElevationUnavailable("the terrain tiles did not answer in time") from error
            except httpx.TransportError as error:
                raise ElevationUnavailable(f"the terrain tiles could not be reached: {error}") from error
            if response.status_code == 200:
                # Void pixels are removed on the tile's own 30 m pixels, before bilinear sampling
                # would smear each one across several grid cells.
                return despike(decode_terrarium(response.content), TILE_SIZE, TILE_SIZE)
            if response.status_code == 404:
                return _ZERO_TILE  # beyond coverage: open ocean
            if response.status_code not in RETRYABLE_STATUSES:
                raise ElevationUnavailable(f"the terrain tiles answered HTTP {response.status_code}")
            if attempt < len(self.backoff_seconds):
                self.sleep(self._retry_delay(response, self.backoff_seconds[attempt]))
        raise ElevationUnavailable(
            f"the terrain tiles are busy (HTTP {response.status_code}) after {len(self.backoff_seconds) + 1} attempts"
        )

    @staticmethod
    def _retry_delay(response: httpx.Response, default: float) -> float:
        try:
            return min(float(response.headers["Retry-After"]), MAX_RETRY_AFTER_SECONDS)
        except (KeyError, ValueError):
            return default
