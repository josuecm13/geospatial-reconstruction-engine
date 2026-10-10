"""Generating an area's buildings against a real (test) database. Blocks are inserted directly, with the
shape the test wants, in the metres of the area's local projection."""

import pytest
from shapely.geometry import Polygon as ShapelyPolygon
from sqlalchemy import func, select

from app.domain.block import Block
from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.building import Building
from app.domain.elevation import ElevationGrid
from app.domain.enums import BuildingCategory
from app.domain.generation import BlockFeedback, CountSource, StaleReason
from app.domain.local_projection import local_projection_for
from app.generation.geometry import from_local_xy
from app.generation.run import GenerationService, stale_reasons
from app.persistence.geometry import multipolygon_to_geom, polygon_to_geom
from app.persistence.models import (
    AreaFeatureModel,
    BlockBoundarySegmentModel,
    BlockModel,
    BuildingModel,
    GeneratedBuildingModel,
    GenerationRunModel,
    GenerationZoneModel,
    PointOfInterestModel,
    RoadModel,
    RoadSegmentModel,
)
from app.persistence.repositories.block import BlockRepository
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.elevation import ElevationRepository
from app.persistence.repositories.generation import BlockFeedbackRepository, GenerationRepository
from app.persistence.repositories.import_area import ImportAreaRepository

OBSERVED = (BlockModel, BuildingModel, AreaFeatureModel, RoadModel, RoadSegmentModel, PointOfInterestModel, BlockBoundarySegmentModel)


def _area(db_session):
    repo = ImportAreaRepository(db_session)
    area = repo.get_or_create("osm", BoundingBox(Coordinate(30.0, -97.8), Coordinate(30.02, -97.78)))
    return repo.mark_completed(area.id, road_count=0, node_count=0, building_count=0, poi_count=0, area_feature_count=0)


def _rect(projection, x0, y0, x1, y1):
    return tuple(from_local_xy(projection, x, y) for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)])


def _block(db_session, area, x0, y0, x1, y1, inset=3.0, **flags):
    """A block whose boundary is the rectangle (metres) and whose buildable area is inset by `inset`."""
    projection = local_projection_for(area.bbox.ring())
    buildable = _rect(projection, x0 + inset, y0 + inset, x1 - inset, y1 - inset)
    model = BlockModel(
        import_area_id=area.id,
        boundary=polygon_to_geom(_rect(projection, x0, y0, x1, y1)),
        area_square_meters=(x1 - x0) * (y1 - y0),
        buildable_area=multipolygon_to_geom((buildable,)),
        buildable_area_square_meters=(x1 - x0 - 2 * inset) * (y1 - y0 - 2 * inset),
        **flags,
    )
    db_session.add(model)
    db_session.flush()
    return model.id


def _house(db_session, area, block_id, x0, y0, x1, y1, number):
    projection = local_projection_for(area.bbox.ring())
    BuildingRepository(db_session).upsert(
        Building(
            id=None,
            import_area_id=area.id,
            source_id=f"way/{number}",
            category=BuildingCategory.RESIDENTIAL,
            geom=_rect(projection, x0, y0, x1, y1),
            block_id=block_id,
            levels=2,
        )
    )


def _built_up_ring(db_session, area, block_id, x0, y0):
    """Eight-metre houses all the way round a 40 m block: an exemplar."""
    number = 0
    for index in range(5):
        _house(db_session, area, block_id, x0 + 8 * index, y0, x0 + 8 * index + 8, y0 + 6, number := number + 1)
        _house(db_session, area, block_id, x0 + 8 * index, y0 + 34, x0 + 8 * index + 8, y0 + 40, number := number + 1)
    for index in range(3):
        y = y0 + 6 + 28 / 3 * index
        _house(db_session, area, block_id, x0, y, x0 + 6, y + 28 / 3, number := number + 1)
        _house(db_session, area, block_id, x0 + 34, y, x0 + 40, y + 28 / 3, number := number + 1)


def _count(db_session, model):
    return db_session.scalar(select(func.count()).select_from(model))


def _observed_counts(db_session):
    return [_count(db_session, model) for model in OBSERVED]


def _shapes(db_session, area):
    return sorted(
        ShapelyPolygon([(p.longitude, p.latitude) for p in building.geom]).wkt
        for building in GenerationRepository(db_session).list_buildings([area.id])
    )


def _by_block(db_session, area):
    grouped = {}
    for building in GenerationRepository(db_session).list_buildings([area.id]):
        grouped.setdefault(building.block_id, []).append(building)
    return grouped


def test_a_block_with_room_gets_buildings_and_the_run_is_stored(db_session):
    area = _area(db_session)
    block_id = _block(db_session, area, 0, 0, 90, 80)

    run = GenerationService(db_session).generate(area, seed=5)

    assert (run.seed, run.algorithm_version, run.eligible_block_count) == (5, "frontage-lots-v1", 1)
    assert run.building_count > 0 and run.block_count == 1
    stored = GenerationRepository(db_session).get_run(area.id)
    assert stored.id == run.id and stored.elevation_version is None
    buildings = _by_block(db_session, area)[block_id]
    assert len(buildings) == run.building_count
    assert {building.count_source for building in buildings} == {CountSource.DEFAULT}
    assert all(building.reference_block_id is None and building.base_elevation_meters is None for building in buildings)
    assert all(building.height_meters == building.levels * 3.0 for building in buildings)
    assert GenerationRepository(db_session).list_zones(area.id), "the setback is a zone"


def test_the_same_seed_gives_identical_buildings_and_another_seed_gives_different_ones(db_session):
    area = _area(db_session)
    _block(db_session, area, 0, 0, 90, 80)
    service = GenerationService(db_session)

    service.generate(area, seed=11)
    first = _shapes(db_session, area)
    service.generate(area, seed=11)
    again = _shapes(db_session, area)
    service.generate(area, seed=12)
    other = _shapes(db_session, area)

    assert first and first == again
    assert other != first


def test_buildings_stay_in_the_buildable_area_clear_of_real_buildings_and_each_other(db_session):
    area = _area(db_session)
    block_id = _block(db_session, area, 0, 0, 90, 80)
    _house(db_session, area, block_id, 30, 3, 50, 23, number=1)
    projection = local_projection_for(area.bbox.ring())
    buildable = ShapelyPolygon([(p.longitude, p.latitude) for p in _rect(projection, 3, 3, 87, 77)])
    real = ShapelyPolygon([(p.longitude, p.latitude) for p in _rect(projection, 30, 3, 50, 23)])

    GenerationService(db_session).generate(area, seed=3)

    shapes = [
        ShapelyPolygon([(p.longitude, p.latitude) for p in building.geom])
        for building in GenerationRepository(db_session).list_buildings([area.id])
    ]
    assert len(shapes) > 1
    assert all(buildable.contains(shape) for shape in shapes)
    assert not any(shape.intersects(real) for shape in shapes)
    assert not any(a.intersects(b) for index, a in enumerate(shapes) for b in shapes[index + 1:])


@pytest.mark.parametrize("flags", [{"is_median": True}, {"is_clipped": True}], ids=["median", "clipped"])
def test_a_block_that_is_not_eligible_gets_nothing(db_session, flags):
    area = _area(db_session)
    _block(db_session, area, 0, 0, 90, 80, **flags)

    run = GenerationService(db_session).generate(area, seed=1)

    assert (run.eligible_block_count, run.building_count) == (0, 0)


def test_a_block_with_no_room_gets_nothing(db_session):
    area = _area(db_session)
    _block(db_session, area, 0, 0, 12, 12, inset=4.0)  # a 4 m square of buildable area

    assert GenerationService(db_session).generate(area, seed=1).eligible_block_count == 0


def test_generation_changes_no_observed_table_and_deleting_the_run_restores_the_counts(db_session):
    area = _area(db_session)
    block_id = _block(db_session, area, 0, 0, 90, 80)
    _house(db_session, area, block_id, 30, 3, 50, 23, number=1)
    before = _observed_counts(db_session)

    GenerationService(db_session).generate(area, seed=1)
    assert _count(db_session, GeneratedBuildingModel) > 0
    assert _observed_counts(db_session) == before

    GenerationRepository(db_session).delete(area.id)
    assert _observed_counts(db_session) == before
    assert [_count(db_session, model) for model in (GenerationRunModel, GeneratedBuildingModel, GenerationZoneModel)] == [0, 0, 0]


def test_generating_again_replaces_the_run(db_session):
    area = _area(db_session)
    _block(db_session, area, 0, 0, 90, 80)
    service = GenerationService(db_session)

    first = service.generate(area, seed=1)
    second = service.generate(area, seed=2)

    assert second.id != first.id
    assert _count(db_session, GenerationRunModel) == 1
    assert GenerationRepository(db_session).get_run(area.id).seed == 2
    assert _count(db_session, GeneratedBuildingModel) == second.building_count


def test_a_run_is_stale_once_the_block_set_or_the_ground_changes(db_session):
    area = _area(db_session)
    _block(db_session, area, 0, 0, 90, 80)
    run = GenerationService(db_session).generate(area, seed=1)
    assert stale_reasons(db_session, area, run) == []

    projection = local_projection_for(area.bbox.ring())
    BlockRepository(db_session).add(
        Block(id=None, import_area_id=area.id, boundary=_rect(projection, 200, 0, 240, 40), area_square_meters=1600.0)
    )
    assert stale_reasons(db_session, area, run) == [StaleReason.ROADS_CHANGED]

    grid = ElevationGrid(area.bbox.min_corner, 0.01, 0.01, 3, 3, (10.0,) * 9)
    ElevationRepository(db_session).save_grid(area.id, grid, 30.0)
    assert stale_reasons(db_session, area, run) == [StaleReason.ROADS_CHANGED, StaleReason.TERRAIN_CHANGED]


def test_a_block_with_a_ground_gets_base_heights(db_session):
    area = _area(db_session)
    _block(db_session, area, 0, 0, 90, 80)
    ElevationRepository(db_session).save_grid(area.id, ElevationGrid(area.bbox.min_corner, 0.01, 0.01, 3, 3, (12.5,) * 9), 30.0)

    run = GenerationService(db_session).generate(area, seed=1)

    assert run.elevation_version == 1
    buildings = GenerationRepository(db_session).list_buildings([area.id])
    assert buildings and all(building.base_elevation_meters == pytest.approx(12.5) for building in buildings)


def test_feedback_sets_the_number_of_buildings_and_no_buildings_clears_the_block(db_session):
    area = _area(db_session)
    block_id = _block(db_session, area, 0, 0, 90, 80)
    feedback = BlockFeedbackRepository(db_session)
    service = GenerationService(db_session)

    feedback.put(BlockFeedback(block_id, area.id, building_count=2))
    run = service.generate(area, seed=1)
    buildings = _by_block(db_session, area)[block_id]
    assert len(buildings) == 2 and {b.count_source for b in buildings} == {CountSource.FEEDBACK}
    assert run.feedback_shortfall_block_ids == []

    feedback.put(BlockFeedback(block_id, area.id, building_count=500))
    run = service.generate(area, seed=1)
    assert run.feedback_shortfall_block_ids == [block_id]
    assert 0 < run.building_count < 500

    feedback.put(BlockFeedback(block_id, area.id, no_buildings=True))
    run = service.generate(area, seed=1)
    assert run.building_count == 0 and block_id not in _by_block(db_session, area)


def test_a_block_learns_from_a_built_up_block_near_it_and_uses_defaults_far_from_one(db_session):
    area = _area(db_session)
    exemplar = _block(db_session, area, 0, 0, 40, 40, inset=0.0)
    _built_up_ring(db_session, area, exemplar, 0, 0)
    near = _block(db_session, area, 100, 0, 190, 80)
    far = _block(db_session, area, 700, 0, 790, 80)

    run = GenerationService(db_session).generate(area, seed=1)

    grouped = _by_block(db_session, area)
    assert {b.reference_block_id for b in grouped[near]} == {exemplar}
    assert {b.count_source for b in grouped[near]} == {CountSource.REFERENCE}
    assert {b.reference_block_id for b in grouped[far]} == {None}
    assert {b.count_source for b in grouped[far]} == {CountSource.DEFAULT}
    assert exemplar in GenerationRepository(db_session).fingerprints(run.id)
    assert run.assignments()[near].reference_block_id == exemplar
    assert run.assignments()[exemplar].reference_block_id == exemplar


def test_feedback_nearby_narrows_the_lots_of_a_block_without_feedback(db_session):
    area = _area(db_session)
    first = _block(db_session, area, 0, 0, 90, 80)
    second = _block(db_session, area, 100, 0, 190, 80)
    target = _block(db_session, area, 200, 0, 290, 80)
    service = GenerationService(db_session)
    feedback = BlockFeedbackRepository(db_session)

    plain = service.generate(area, seed=1)
    lots = {block_id: item.lot_count for block_id, item in plain.assignments().items()}
    assert plain.calibration_ratio is None
    plain_count = len(_by_block(db_session, area)[target])

    feedback.put(BlockFeedback(first, area.id, building_count=2 * lots[first]))
    feedback.put(BlockFeedback(second, area.id, building_count=2 * lots[second]))
    calibrated = service.generate(area, seed=1)

    assert calibrated.calibration_ratio == pytest.approx(2.0)
    assert calibrated.assignments()[target].calibration_ratio == pytest.approx(2.0)
    assert calibrated.assignments()[first].calibration_ratio is None
    assert len(_by_block(db_session, area)[target]) > plain_count


def test_one_feedback_block_is_not_enough_to_calibrate(db_session):
    area = _area(db_session)
    first = _block(db_session, area, 0, 0, 90, 80)
    _block(db_session, area, 100, 0, 190, 80)
    service = GenerationService(db_session)
    plain = service.generate(area, seed=1)

    BlockFeedbackRepository(db_session).put(
        BlockFeedback(first, area.id, building_count=2 * plain.assignments()[first].lot_count)
    )
    run = service.generate(area, seed=1)

    assert run.calibration_ratio is None
