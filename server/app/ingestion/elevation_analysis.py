"""Computes an area's elevation: the grid, then the heights every consumer reads from it."""

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.domain.elevation import SMOOTHING_METERS, building_base_height, smoothed, vertex_heights
from app.domain.import_area import ImportArea
from app.ingestion.elevation_source import TerrainTilesSource
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.elevation import ElevationRepository
from app.persistence.repositories.road_graph import RoadSegmentRepository

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ElevationResult:
    version: int
    # Whether the stored grid differs from the one before this analysis (always true the first time).
    changed: bool
    building_count: int
    segment_count: int


class ElevationAnalysis:
    """Fetches an area's grid and stores it with the building base heights and road vertex heights
    derived from it. It reads buildings and road segments and writes only the elevation tables.
    The caller commits."""

    def __init__(self, session: Session, source: TerrainTilesSource):
        self.session = session
        self.source = source

    def analyse(self, area: ImportArea) -> ElevationResult:
        """Raises `ElevationUnavailable` before writing anything when the terrain source fails."""
        fetched = self.source.fetch_grid(area.bbox)

        elevation = ElevationRepository(self.session)
        previous = elevation.get_grid(area.id)
        version = elevation.save_grid(area.id, fetched, SMOOTHING_METERS)
        # Derive from the grid as stored (float32), so what the API serves and what the heights were
        # computed from are the same numbers, and a second run reproduces them exactly.
        grid = elevation.get_grid(area.id).grid
        smooth = smoothed(grid, SMOOTHING_METERS)

        buildings = BuildingRepository(self.session).list_for_import_area(area.id)
        bases = {building.id: building_base_height(grid, building.geom) for building in buildings}
        elevation.replace_building_bases(area.id, bases)

        segments = RoadSegmentRepository(self.session).list_for_import_area(area.id)
        heights = {
            segment.id: (vertex_heights(grid, segment.geom), vertex_heights(smooth, segment.geom))
            for segment in segments
        }
        elevation.replace_segment_heights(area.id, heights)

        result = ElevationResult(
            version=version,
            changed=previous is None or version != previous.version,
            building_count=len(bases),
            segment_count=len(heights),
        )
        logger.info(
            "elevation for area %s: version %d (%s), %d buildings, %d segments",
            area.id, result.version, "changed" if result.changed else "unchanged", result.building_count, result.segment_count,
        )
        return result
