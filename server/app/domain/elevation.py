"""An area's ground as a regular grid of heights, and the heights derived from it.

The grid is aligned to the area's bounding box in WGS84 degrees: the origin is the south-west
corner, `rows` x `cols` samples include both edges, and heights are metres above sea level,
row-major from south to north and, within a row, west to east. Everything else (a building's base,
a road vertex's height) is computed from it by the pure functions here."""

import math
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.geometry import LineString, Polygon
from app.domain.local_projection import LocalProjection, local_projection_for

SMOOTHING_METERS = 30.0
ELEVATION_SOURCE = "aws-terrain-tiles"
ELEVATION_ALGORITHM = "terrarium-z15-bilinear-despike-v2"
TERRAIN_ATTRIBUTION = (
    "Terrain: AWS Terrain Tiles (Mapzen/Tilezen) — 3DEP, SRTM, GMTED2010 courtesy of the U.S. Geological Survey; "
    "ETOPO1 NOAA; EU-DEM produced using Copernicus data; and others "
    "(github.com/tilezen/joerd/blob/master/docs/attribution.md)"
)

# A void or bad pixel in the source model is a lone cell far from every neighbour (observed: -300 m
# beside a coast at sea level). Real terrain sampled at 30 m rarely differs from the median of its
# neighbours by more than this and also lies outside all of them, short of a cliff or a quarry wall.
SPIKE_THRESHOLD_METERS = 15.0

DEFAULT_SPACING_METERS = 5.0
MIN_SAMPLES = 2
MAX_SAMPLES = 256


@dataclass(frozen=True)
class ElevationGrid:
    origin: Coordinate  # south-west corner
    lat_step: float
    lon_step: float
    rows: int
    cols: int
    heights: tuple[float, ...]

    def __post_init__(self) -> None:
        if self.rows < 2 or self.cols < 2:
            raise ValueError(f"an elevation grid needs at least 2 rows and 2 columns, got {self.rows} x {self.cols}")
        if self.lat_step <= 0 or self.lon_step <= 0:
            raise ValueError("elevation grid steps must be positive")
        if len(self.heights) != self.rows * self.cols:
            raise ValueError(
                f"an elevation grid of {self.rows} x {self.cols} needs {self.rows * self.cols} heights, "
                f"got {len(self.heights)}"
            )

    def height_at(self, row: int, col: int) -> float:
        if not (0 <= row < self.rows and 0 <= col < self.cols):
            raise IndexError(f"({row}, {col}) is outside the {self.rows} x {self.cols} grid")
        return self.heights[row * self.cols + col]

    def coordinate_at(self, row: int, col: int) -> Coordinate:
        return Coordinate(
            latitude=self.origin.latitude + row * self.lat_step,
            longitude=self.origin.longitude + col * self.lon_step,
        )

    def contains(self, point: Coordinate) -> bool:
        return (
            self.origin.latitude <= point.latitude <= self.origin.latitude + (self.rows - 1) * self.lat_step
            and self.origin.longitude <= point.longitude <= self.origin.longitude + (self.cols - 1) * self.lon_step
        )

    def points(self) -> Iterator[tuple[int, int, Coordinate]]:
        """Every grid coordinate with its row and column, in storage order."""
        for row in range(self.rows):
            for col in range(self.cols):
                yield row, col, self.coordinate_at(row, col)

    def sample(self, point: Coordinate) -> float:
        """The height at `point`, bilinear between the four surrounding samples. A point outside the
        grid takes the height at the nearest edge."""
        row = min(max((point.latitude - self.origin.latitude) / self.lat_step, 0.0), self.rows - 1.0)
        col = min(max((point.longitude - self.origin.longitude) / self.lon_step, 0.0), self.cols - 1.0)
        row0, col0 = min(int(row), self.rows - 2), min(int(col), self.cols - 2)
        row_fraction, col_fraction = row - row0, col - col0
        south = self.height_at(row0, col0) * (1 - col_fraction) + self.height_at(row0, col0 + 1) * col_fraction
        north = self.height_at(row0 + 1, col0) * (1 - col_fraction) + self.height_at(row0 + 1, col0 + 1) * col_fraction
        return south * (1 - row_fraction) + north * row_fraction


def despike(heights: Sequence[float], rows: int, cols: int, threshold: float = SPIKE_THRESHOLD_METERS) -> tuple[float, ...]:
    """Replaces void pixels in a row-major lattice of heights with the median of their neighbours.

    A cell is a spike when it differs from the median of its in-lattice neighbours (8, fewer on edges
    and corners) by more than `threshold` and lies outside the range of the neighbours that are
    themselves within `threshold` of that median. Ignoring the neighbours that deviate lets a
    cluster of two or three bad cells be caught, where each would otherwise hide inside the range
    set by the other. Pits and peaks are both handled. It is one pass over the original values, so
    corrections never cascade, and a ramp, however steep, is untouched: its cells lie inside the
    range of their neighbours."""
    if len(heights) != rows * cols:
        raise ValueError(f"{rows} x {cols} cells need {rows * cols} heights, got {len(heights)}")
    result = list(heights)
    for row in range(rows):
        for col in range(cols):
            neighbours = sorted(
                heights[r * cols + c]
                for r in range(max(row - 1, 0), min(row + 2, rows))
                for c in range(max(col - 1, 0), min(col + 2, cols))
                if (r, c) != (row, col)
            )
            if not neighbours:
                continue
            middle = len(neighbours) // 2
            median = neighbours[middle] if len(neighbours) % 2 else (neighbours[middle - 1] + neighbours[middle]) / 2
            value = heights[row * cols + col]
            if abs(value - median) <= threshold:
                continue
            plausible = [n for n in neighbours if abs(n - median) <= threshold]
            if value < min(plausible) or value > max(plausible):
                result[row * cols + col] = median
    return tuple(result)


@dataclass(frozen=True)
class StoredGrid:
    """An area's grid as stored, with where it came from. `version` changes only when the heights,
    size or origin do."""

    grid: ElevationGrid
    version: int
    source: str
    algorithm: str
    smoothing_meters: float
    analysed_at: datetime


def grid_size_for(
    bbox: BoundingBox, target_spacing_m: float = DEFAULT_SPACING_METERS, max_samples: int = MAX_SAMPLES
) -> tuple[int, int]:
    """(rows, cols) giving about `target_spacing_m` between samples on each axis, clamped to between
    2 and `max_samples` per axis. Metres per degree come from the box's local projection."""
    projection = local_projection_for(bbox.ring())
    height_m = (bbox.max_corner.latitude - bbox.min_corner.latitude) * projection.meters_per_degree_latitude
    width_m = (bbox.max_corner.longitude - bbox.min_corner.longitude) * projection.meters_per_degree_longitude

    def samples(extent_m: float) -> int:
        return min(max(round(extent_m / target_spacing_m) + 1, MIN_SAMPLES), max_samples)

    return samples(height_m), samples(width_m)


def _projection_of(grid: ElevationGrid) -> LocalProjection:
    north = grid.origin.latitude + (grid.rows - 1) * grid.lat_step
    east = grid.origin.longitude + (grid.cols - 1) * grid.lon_step
    sw, ne = grid.origin, Coordinate(north, east)
    return local_projection_for((sw, Coordinate(sw.latitude, ne.longitude), ne, Coordinate(ne.latitude, sw.longitude), sw))


def _box_blur(values: list[float], radius: int) -> list[float]:
    """A moving average over `2 * radius + 1` values, with the ends clamped to the first and last."""
    if radius <= 0:
        return values
    count = len(values)
    prefix = [0.0]
    for value in values:
        prefix.append(prefix[-1] + value)

    def total(low: int, high: int) -> float:  # sum of values[low..high], indices clamped
        result = 0.0
        if low < 0:
            result += -low * values[0]
            low = 0
        if high > count - 1:
            result += (high - count + 1) * values[-1]
            high = count - 1
        return result + prefix[high + 1] - prefix[low]

    width = 2 * radius + 1
    return [total(index - radius, index + radius) / width for index in range(count)]


def smoothed(grid: ElevationGrid, radius_m: float) -> ElevationGrid:
    """A low-pass of the grid: a separable box blur of `radius_m`. The radius in cells is worked out
    per axis from metres per degree, edges are clamped, and the grid's metadata is unchanged."""
    projection = _projection_of(grid)
    row_radius = round(radius_m / (grid.lat_step * projection.meters_per_degree_latitude))
    col_radius = round(radius_m / (grid.lon_step * projection.meters_per_degree_longitude))

    rows = [_box_blur(list(grid.heights[row * grid.cols:(row + 1) * grid.cols]), col_radius) for row in range(grid.rows)]
    columns = [_box_blur([rows[row][col] for row in range(grid.rows)], row_radius) for col in range(grid.cols)]
    heights = tuple(columns[col][row] for row in range(grid.rows) for col in range(grid.cols))
    return ElevationGrid(grid.origin, grid.lat_step, grid.lon_step, grid.rows, grid.cols, heights)


def _inside(point: Coordinate, ring: Polygon) -> bool:
    """Even-odd ray casting in (longitude, latitude)."""
    inside = False
    for a, b in zip(ring, ring[1:]):
        if (a.latitude > point.latitude) != (b.latitude > point.latitude):
            crossing = a.longitude + (point.latitude - a.latitude) / (b.latitude - a.latitude) * (b.longitude - a.longitude)
            if point.longitude < crossing:
                inside = not inside
    return inside


def building_base_height(grid: ElevationGrid, footprint: Polygon) -> float:
    """The lowest ground under a footprint: the minimum of the grid sampled at the footprint's
    vertices and at every grid point inside it, so nothing floats."""
    lowest = min(grid.sample(vertex) for vertex in footprint)
    latitudes = [vertex.latitude for vertex in footprint]
    longitudes = [vertex.longitude for vertex in footprint]
    row_low = max(math.ceil((min(latitudes) - grid.origin.latitude) / grid.lat_step), 0)
    row_high = min(math.floor((max(latitudes) - grid.origin.latitude) / grid.lat_step), grid.rows - 1)
    col_low = max(math.ceil((min(longitudes) - grid.origin.longitude) / grid.lon_step), 0)
    col_high = min(math.floor((max(longitudes) - grid.origin.longitude) / grid.lon_step), grid.cols - 1)
    for row in range(row_low, row_high + 1):
        for col in range(col_low, col_high + 1):
            height = grid.height_at(row, col)
            if height < lowest and _inside(grid.coordinate_at(row, col), footprint):
                lowest = height
    return lowest


def vertex_heights(grid: ElevationGrid, line: LineString) -> tuple[float, ...]:
    return tuple(grid.sample(vertex) for vertex in line)
