import struct
from collections.abc import Mapping
from datetime import datetime, timezone

from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session

from app.domain.bounding_box import Coordinate
from app.domain.elevation import ELEVATION_ALGORITHM, ELEVATION_SOURCE, ElevationGrid, StoredGrid
from app.persistence.models import (
    AreaElevationGridModel,
    BuildingElevationModel,
    BuildingModel,
    RoadModel,
    RoadSegmentElevationModel,
    RoadSegmentModel,
)
from app.persistence.repositories.batching import chunked


def pack_heights(heights: tuple[float, ...]) -> bytes:
    """Little-endian float32, in grid order."""
    return struct.pack(f"<{len(heights)}f", *heights)


def unpack_heights(data: bytes) -> tuple[float, ...]:
    return struct.unpack(f"<{len(data) // 4}f", data)


class ElevationRepository:
    """An area's elevation grid and the heights derived from it. Nothing here touches an observed
    table, and the caller commits."""

    def __init__(self, session: Session):
        self.session = session

    def get_grid(self, import_area_id) -> StoredGrid | None:
        model = self.session.get(AreaElevationGridModel, import_area_id)
        if model is None:
            return None
        return StoredGrid(
            grid=ElevationGrid(
                origin=Coordinate(model.origin_latitude, model.origin_longitude),
                lat_step=model.lat_step,
                lon_step=model.lon_step,
                rows=model.rows,
                cols=model.cols,
                heights=unpack_heights(model.heights),
            ),
            version=model.version,
            source=model.source,
            algorithm=model.algorithm,
            smoothing_meters=model.smoothing_meters,
            analysed_at=model.analysed_at,
        )

    def save_grid(
        self,
        import_area_id,
        grid: ElevationGrid,
        smoothing_meters: float,
        source: str = ELEVATION_SOURCE,
        algorithm: str = ELEVATION_ALGORITHM,
    ) -> int:
        """Stores the grid and returns its version: 1 for a first save, the existing version when
        the stored origin, steps, size and heights are identical, and the next one when they differ.

        Heights are compared as the packed float32 bytes that are stored, so a grid read back from
        the database compares equal to the one it was saved from."""
        packed = pack_heights(grid.heights)
        model = self.session.get(AreaElevationGridModel, import_area_id)
        if model is None:
            self.session.add(
                AreaElevationGridModel(
                    import_area_id=import_area_id,
                    origin_latitude=grid.origin.latitude,
                    origin_longitude=grid.origin.longitude,
                    lat_step=grid.lat_step,
                    lon_step=grid.lon_step,
                    rows=grid.rows,
                    cols=grid.cols,
                    heights=packed,
                    source=source,
                    algorithm=algorithm,
                    version=1,
                    smoothing_meters=smoothing_meters,
                    analysed_at=datetime.now(timezone.utc),
                )
            )
            self.session.flush()
            return 1

        unchanged = (
            (model.origin_latitude, model.origin_longitude, model.lat_step, model.lon_step, model.rows, model.cols)
            == (grid.origin.latitude, grid.origin.longitude, grid.lat_step, grid.lon_step, grid.rows, grid.cols)
            and bytes(model.heights) == packed
        )
        if unchanged:
            if model.smoothing_meters != smoothing_meters:
                model.smoothing_meters = smoothing_meters  # a setting, not the ground: no new version
                self.session.flush()
            return model.version

        model.origin_latitude = grid.origin.latitude
        model.origin_longitude = grid.origin.longitude
        model.lat_step = grid.lat_step
        model.lon_step = grid.lon_step
        model.rows = grid.rows
        model.cols = grid.cols
        model.heights = packed
        model.source = source
        model.algorithm = algorithm
        model.smoothing_meters = smoothing_meters
        model.version += 1
        model.analysed_at = datetime.now(timezone.utc)
        self.session.flush()
        return model.version

    def replace_building_bases(self, import_area_id, bases: Mapping) -> None:
        """Makes the area's stored building base heights exactly `bases` (building id -> metres)."""
        area_buildings = select(BuildingModel.id).where(BuildingModel.import_area_id == import_area_id)
        self.session.execute(delete(BuildingElevationModel).where(BuildingElevationModel.building_id.in_(area_buildings)))
        rows = [{"building_id": building_id, "base_elevation_meters": base} for building_id, base in bases.items()]
        for batch in chunked(rows):
            self.session.execute(insert(BuildingElevationModel), list(batch))

    def replace_segment_heights(self, import_area_id, heights: Mapping) -> None:
        """Makes the area's stored segment vertex heights exactly `heights` (segment id ->
        (exact, smoothed), one value per vertex each)."""
        self.session.execute(
            delete(RoadSegmentElevationModel).where(
                RoadSegmentElevationModel.road_segment_id.in_(self._area_segment_ids(import_area_id))
            )
        )
        rows = [
            {"road_segment_id": segment_id, "exact_meters": list(exact), "smoothed_meters": list(smoothed)}
            for segment_id, (exact, smoothed) in heights.items()
        ]
        for batch in chunked(rows):
            self.session.execute(insert(RoadSegmentElevationModel), list(batch))

    def building_bases(self, import_area_id) -> dict:
        """Building id -> base elevation in metres, for the area's buildings that have one."""
        rows = self.session.execute(
            select(BuildingElevationModel.building_id, BuildingElevationModel.base_elevation_meters)
            .join(BuildingModel, BuildingModel.id == BuildingElevationModel.building_id)
            .where(BuildingModel.import_area_id == import_area_id)
        ).all()
        return {building_id: base for building_id, base in rows}

    def segment_heights(self, import_area_id) -> dict:
        """Segment id -> (exact, smoothed) vertex heights, for the area's segments that have them."""
        rows = self.session.execute(
            select(
                RoadSegmentElevationModel.road_segment_id,
                RoadSegmentElevationModel.exact_meters,
                RoadSegmentElevationModel.smoothed_meters,
            )
            .join(RoadSegmentModel, RoadSegmentModel.id == RoadSegmentElevationModel.road_segment_id)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .where(RoadModel.import_area_id == import_area_id)
        ).all()
        return {segment_id: (tuple(exact), tuple(smoothed)) for segment_id, exact, smoothed in rows}

    @staticmethod
    def _area_segment_ids(import_area_id):
        return (
            select(RoadSegmentModel.id)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .where(RoadModel.import_area_id == import_area_id)
        )
