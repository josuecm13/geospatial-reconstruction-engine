"""Terrain sources for API tests, so none of them reaches the network."""

from app.domain.bounding_box import BoundingBox
from app.domain.elevation import ElevationGrid, grid_size_for


class SlopedSource:
    """A plane rising `slope` metres per grid column over the box, on the grid the real source lays.
    `calls` counts fetches."""

    def __init__(self, base: float = 10.0, slope: float = 0.5):
        self.base = base
        self.slope = slope
        self.calls = 0

    def fetch_grid(self, bbox: BoundingBox) -> ElevationGrid:
        self.calls += 1
        rows, cols = grid_size_for(bbox)
        south, west = bbox.min_corner.latitude, bbox.min_corner.longitude
        return ElevationGrid(
            origin=bbox.min_corner,
            lat_step=(bbox.max_corner.latitude - south) / (rows - 1),
            lon_step=(bbox.max_corner.longitude - west) / (cols - 1),
            rows=rows,
            cols=cols,
            heights=tuple(self.base + self.slope * col for _ in range(rows) for col in range(cols)),
        )


class DownSource:
    """A terrain source that is unreachable."""

    def fetch_grid(self, bbox: BoundingBox) -> ElevationGrid:
        from app.ingestion.elevation_source import ElevationUnavailable

        raise ElevationUnavailable("terrain tiles are down")


class BrokenSource:
    """A terrain source with a bug: it fails with something other than `ElevationUnavailable`."""

    def fetch_grid(self, bbox: BoundingBox) -> ElevationGrid:
        raise RuntimeError("the terrain source is broken")
