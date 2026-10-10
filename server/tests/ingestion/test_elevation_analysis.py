import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.elevation import ElevationGrid
from app.ingestion.elevation_analysis import ElevationAnalysis
from app.ingestion.elevation_source import ElevationUnavailable
from app.ingestion.service import OSMIngestionService
from app.persistence.models import (
    AreaElevationGridModel,
    BlockModel,
    BuildingElevationModel,
    BuildingModel,
    RoadSegmentElevationModel,
    RoadSegmentModel,
)
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.elevation import ElevationRepository
from app.persistence.repositories.road_graph import RoadSegmentRepository

FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"
BBOX = BoundingBox(Coordinate(9.933, -84.081), Coordinate(9.935, -84.079))
LON_STEP = 0.002 / 4


class StubSource:
    """Stands in for TerrainTilesSource: no network."""

    def __init__(self, grid=None, error=None):
        self.grid, self.error, self.requested = grid, error, []

    def fetch_grid(self, bbox):
        self.requested.append(bbox)
        if self.error is not None:
            raise self.error
        return self.grid


def sloped_grid(drop_per_column=10.0):
    """Falls to the east, 50 m at the west edge, and does not vary north to south."""
    return ElevationGrid(
        BBOX.min_corner, 0.002 / 4, LON_STEP, 5, 5,
        tuple(50.0 - drop_per_column * col for _row in range(5) for col in range(5)),
    )


def imported_area(db_session):
    return OSMIngestionService(db_session).import_fixture(BBOX, json.loads(FIXTURE.read_text())).import_area


def elevation_rows(db_session):
    return (
        db_session.execute(select(AreaElevationGridModel.import_area_id, AreaElevationGridModel.version, AreaElevationGridModel.heights)).all(),
        sorted(db_session.execute(select(BuildingElevationModel.building_id, BuildingElevationModel.base_elevation_meters)).all()),
        sorted(
            db_session.execute(
                select(
                    RoadSegmentElevationModel.road_segment_id,
                    RoadSegmentElevationModel.exact_meters,
                    RoadSegmentElevationModel.smoothed_meters,
                )
            ).all()
        ),
    )


def entities(db_session):
    return (
        sorted(db_session.scalars(select(BuildingModel.id))),
        sorted(db_session.scalars(select(BlockModel.id))),
        sorted(db_session.scalars(select(RoadSegmentModel.id))),
    )


def count(db_session, model):
    return db_session.scalar(select(func.count()).select_from(model))


def test_building_bases_are_their_lowest_corners_and_segments_get_a_value_per_vertex(db_session):
    area = imported_area(db_session)
    source = StubSource(sloped_grid())

    result = ElevationAnalysis(db_session, source).analyse(area)

    assert source.requested == [area.bbox]
    assert result.version == 1 and result.changed
    buildings = BuildingRepository(db_session).list_for_import_area(area.id)
    segments = RoadSegmentRepository(db_session).list_for_import_area(area.id)
    assert buildings and segments
    assert (result.building_count, result.segment_count) == (len(buildings), len(segments))

    elevation = ElevationRepository(db_session)
    bases = elevation.building_bases(area.id)
    for building in buildings:
        easternmost = max(vertex.longitude for vertex in building.geom)
        expected = 50.0 - 10.0 * (easternmost - BBOX.min_corner.longitude) / LON_STEP
        assert bases[building.id] == pytest.approx(expected, abs=1e-3)

    stored = elevation.segment_heights(area.id)
    assert set(stored) == {segment.id for segment in segments}
    for segment in segments:
        exact, smoothed = stored[segment.id]
        assert len(exact) == len(smoothed) == len(segment.geom)
        for vertex, height in zip(segment.geom, exact):
            assert height == pytest.approx(50.0 - 10.0 * (vertex.longitude - BBOX.min_corner.longitude) / LON_STEP, abs=1e-3)
    assert elevation.get_grid(area.id).version == 1


def test_a_second_analysis_changes_nothing(db_session):
    area = imported_area(db_session)
    analysis = ElevationAnalysis(db_session, StubSource(sloped_grid()))
    first = analysis.analyse(area)
    rows_before = elevation_rows(db_session)
    analysed_before = ElevationRepository(db_session).get_grid(area.id).analysed_at

    second = analysis.analyse(area)

    assert (second.version, second.changed) == (first.version, False)
    assert (second.building_count, second.segment_count) == (first.building_count, first.segment_count)
    assert elevation_rows(db_session) == rows_before
    assert ElevationRepository(db_session).get_grid(area.id).analysed_at == analysed_before


def test_a_different_grid_bumps_the_version_and_rewrites_the_heights(db_session):
    area = imported_area(db_session)
    ElevationAnalysis(db_session, StubSource(sloped_grid(10.0))).analyse(area)
    before = ElevationRepository(db_session).building_bases(area.id)

    result = ElevationAnalysis(db_session, StubSource(sloped_grid(20.0))).analyse(area)

    assert (result.version, result.changed) == (2, True)
    after = ElevationRepository(db_session).building_bases(area.id)
    assert set(after) == set(before)
    assert all(after[building_id] < before[building_id] for building_id in before)


def test_analysis_leaves_the_observed_entities_alone(db_session):
    area = imported_area(db_session)
    before = entities(db_session)
    buildings_before = sorted(BuildingRepository(db_session).list_for_import_area(area.id), key=lambda b: b.id)

    analysis = ElevationAnalysis(db_session, StubSource(sloped_grid()))
    analysis.analyse(area)
    analysis.analyse(area)
    db_session.expire_all()

    assert entities(db_session) == before
    assert sorted(BuildingRepository(db_session).list_for_import_area(area.id), key=lambda b: b.id) == buildings_before


def test_an_unavailable_source_writes_nothing(db_session):
    area = imported_area(db_session)

    with pytest.raises(ElevationUnavailable):
        ElevationAnalysis(db_session, StubSource(error=ElevationUnavailable("down"))).analyse(area)

    assert count(db_session, AreaElevationGridModel) == 0
    assert count(db_session, BuildingElevationModel) == 0
    assert count(db_session, RoadSegmentElevationModel) == 0


def test_an_unavailable_source_keeps_the_previous_analysis(db_session):
    area = imported_area(db_session)
    ElevationAnalysis(db_session, StubSource(sloped_grid())).analyse(area)
    rows_before = elevation_rows(db_session)

    with pytest.raises(ElevationUnavailable):
        ElevationAnalysis(db_session, StubSource(error=ElevationUnavailable("down"))).analyse(area)

    assert elevation_rows(db_session) == rows_before
