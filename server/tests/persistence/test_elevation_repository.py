import json
from pathlib import Path

from sqlalchemy import func, select

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.elevation import ELEVATION_ALGORITHM, ELEVATION_SOURCE, ElevationGrid
from app.ingestion.service import OSMIngestionService
from app.persistence.models import (
    AreaElevationGridModel,
    BuildingElevationModel,
    BuildingModel,
    RoadModel,
    RoadSegmentElevationModel,
    RoadSegmentModel,
)
from app.persistence.repositories.elevation import ElevationRepository
from app.persistence.repositories.import_area import ImportAreaRepository

FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"
BBOX = BoundingBox(Coordinate(9.933, -84.081), Coordinate(9.935, -84.079))


def imported_area(db_session):
    return OSMIngestionService(db_session).import_fixture(BBOX, json.loads(FIXTURE.read_text())).import_area


def grid(offset=0.0, rows=3, cols=4):
    # 0.1 is not representable in float32, so a stored grid only compares equal if compared packed.
    heights = tuple(0.1 * index + offset for index in range(rows * cols))
    return ElevationGrid(BBOX.min_corner, 0.001, 0.0005, rows, cols, heights)


def building_ids(db_session, area):
    return list(db_session.scalars(select(BuildingModel.id).where(BuildingModel.import_area_id == area.id)))


def segment_ids(db_session, area):
    return list(
        db_session.scalars(
            select(RoadSegmentModel.id)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .where(RoadModel.import_area_id == area.id)
        )
    )


def count(db_session, model):
    return db_session.scalar(select(func.count()).select_from(model))


def test_there_is_no_grid_until_one_is_saved(db_session):
    area = imported_area(db_session)

    assert ElevationRepository(db_session).get_grid(area.id) is None


def test_first_save_is_version_one_and_reads_back(db_session):
    area = imported_area(db_session)
    repo = ElevationRepository(db_session)

    version = repo.save_grid(area.id, grid(), 30.0)
    db_session.expire_all()
    stored = repo.get_grid(area.id)

    assert version == 1
    assert stored.version == 1
    assert (stored.source, stored.algorithm, stored.smoothing_meters) == (ELEVATION_SOURCE, ELEVATION_ALGORITHM, 30.0)
    assert stored.analysed_at is not None
    assert (stored.grid.origin, stored.grid.lat_step, stored.grid.lon_step) == (BBOX.min_corner, 0.001, 0.0005)
    assert (stored.grid.rows, stored.grid.cols) == (3, 4)
    assert all(abs(read - written) < 1e-5 for read, written in zip(stored.grid.heights, grid().heights))


def test_an_identical_save_keeps_the_version_and_the_row(db_session):
    area = imported_area(db_session)
    repo = ElevationRepository(db_session)
    repo.save_grid(area.id, grid(), 30.0)
    db_session.expire_all()
    before = repo.get_grid(area.id)

    # Fresh float64 heights that only match the stored float32 ones after packing.
    version = repo.save_grid(area.id, grid(), 30.0)
    db_session.expire_all()
    after = repo.get_grid(area.id)

    assert version == 1
    assert after == before


def test_a_grid_read_back_from_the_database_saves_as_unchanged(db_session):
    area = imported_area(db_session)
    repo = ElevationRepository(db_session)
    repo.save_grid(area.id, grid(), 30.0)
    db_session.expire_all()

    assert repo.save_grid(area.id, repo.get_grid(area.id).grid, 30.0) == 1


def test_changed_heights_size_or_origin_bump_the_version(db_session):
    area = imported_area(db_session)
    repo = ElevationRepository(db_session)
    repo.save_grid(area.id, grid(), 30.0)

    assert repo.save_grid(area.id, grid(offset=1.0), 30.0) == 2
    assert repo.save_grid(area.id, grid(offset=1.0), 30.0) == 2
    assert repo.save_grid(area.id, grid(offset=1.0, rows=4, cols=3), 30.0) == 3
    moved = ElevationGrid(Coordinate(9.9331, -84.081), 0.001, 0.0005, 4, 3, grid(offset=1.0, rows=4, cols=3).heights)
    assert repo.save_grid(area.id, moved, 30.0) == 4
    db_session.expire_all()
    stored = repo.get_grid(area.id)
    assert stored.version == 4
    assert stored.grid.origin == Coordinate(9.9331, -84.081)
    assert count(db_session, AreaElevationGridModel) == 1


def test_a_changed_smoothing_setting_alone_does_not_bump_the_version(db_session):
    area = imported_area(db_session)
    repo = ElevationRepository(db_session)
    repo.save_grid(area.id, grid(), 30.0)

    assert repo.save_grid(area.id, grid(), 50.0) == 1
    assert repo.get_grid(area.id).smoothing_meters == 50.0


def test_replacing_building_bases_is_idempotent(db_session):
    area = imported_area(db_session)
    repo = ElevationRepository(db_session)
    buildings = building_ids(db_session, area)
    assert buildings
    bases = {building_id: 12.5 + index for index, building_id in enumerate(buildings)}

    repo.replace_building_bases(area.id, bases)
    repo.replace_building_bases(area.id, bases)

    assert repo.building_bases(area.id) == bases
    assert count(db_session, BuildingElevationModel) == len(buildings)

    repo.replace_building_bases(area.id, {buildings[0]: 3.0})
    assert repo.building_bases(area.id) == {buildings[0]: 3.0}


def test_replacing_segment_heights_is_idempotent(db_session):
    area = imported_area(db_session)
    repo = ElevationRepository(db_session)
    segments = segment_ids(db_session, area)
    assert segments
    heights = {segment_id: ((1.0, 2.0), (1.5, 1.75)) for segment_id in segments}

    repo.replace_segment_heights(area.id, heights)
    repo.replace_segment_heights(area.id, heights)

    assert repo.segment_heights(area.id) == heights
    assert count(db_session, RoadSegmentElevationModel) == len(segments)

    repo.replace_segment_heights(area.id, {segments[0]: ((9.0, 8.0, 7.0), (6.0, 5.0, 4.0))})
    assert repo.segment_heights(area.id) == {segments[0]: ((9.0, 8.0, 7.0), (6.0, 5.0, 4.0))}


def test_replacing_one_area_leaves_another_areas_heights_alone(db_session):
    area = imported_area(db_session)
    other_bbox = BoundingBox(Coordinate(9.9398, -84.0902), Coordinate(9.9407, -84.0893))
    loop_payload = json.loads((Path(__file__).parents[1] / "fixtures" / "osm_block_loop.json").read_text())
    other = OSMIngestionService(db_session).import_fixture(other_bbox, loop_payload).import_area
    repo = ElevationRepository(db_session)
    other_segments = segment_ids(db_session, other)
    assert other_segments
    repo.replace_segment_heights(other.id, {other_segments[0]: ((1.0, 1.0), (1.0, 1.0))})

    repo.replace_segment_heights(area.id, {})
    repo.replace_building_bases(area.id, {})

    assert repo.segment_heights(other.id) == {other_segments[0]: ((1.0, 1.0), (1.0, 1.0))}


def test_deleting_an_area_removes_its_elevation_rows(db_session):
    area = imported_area(db_session)
    repo = ElevationRepository(db_session)
    repo.save_grid(area.id, grid(), 30.0)
    repo.replace_building_bases(area.id, {building_id: 1.0 for building_id in building_ids(db_session, area)})
    repo.replace_segment_heights(area.id, {segment_id: ((1.0,), (1.0,)) for segment_id in segment_ids(db_session, area)})
    assert count(db_session, AreaElevationGridModel) == 1
    assert count(db_session, BuildingElevationModel) > 0
    assert count(db_session, RoadSegmentElevationModel) > 0

    assert ImportAreaRepository(db_session).delete(area.id)

    assert count(db_session, AreaElevationGridModel) == 0
    assert count(db_session, BuildingElevationModel) == 0
    assert count(db_session, RoadSegmentElevationModel) == 0
