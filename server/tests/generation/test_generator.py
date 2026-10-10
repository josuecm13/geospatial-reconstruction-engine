import random
import uuid
from dataclasses import replace

import pytest
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.geometry import box

from app.domain.block import Block
from app.domain.bounding_box import Coordinate
from app.domain.elevation import ElevationGrid
from app.domain.generation import (
    BlockFeedback,
    CountSource,
    RoadClassGroup,
    SettlementStyle,
    ZoneReason,
    default_fingerprint,
)
from app.domain.local_projection import local_projection_for
from app.generation.generator import generate_block
from app.generation.geometry import from_local_xy
from app.generation.suitability import suitability

AREA_ID = uuid.uuid4()
SEED_RING = (Coordinate(0.0, 0.0), Coordinate(0.0, 0.01), Coordinate(0.01, 0.01), Coordinate(0.01, 0.0), Coordinate(0.0, 0.0))
PROJECTION = local_projection_for(SEED_RING)
FINGERPRINT = default_fingerprint(RoadClassGroup.LOCAL, SettlementStyle.REGULAR)  # 10 x 12 m, 4 m back, 3 m apart


def _rect(x0, y0, x1, y1):
    return tuple(from_local_xy(PROJECTION, x, y) for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)])


def _block():
    return Block(
        id=uuid.UUID(int=1),
        import_area_id=AREA_ID,
        boundary=_rect(-5, -5, 85, 65),
        area_square_meters=90 * 70,
        buildable_area=(_rect(0, 0, 80, 60),),
        buildable_area_square_meters=80 * 60,
    )


def _suitability(style=SettlementStyle.REGULAR):
    result = suitability(
        _block(),
        projection=PROJECTION,
        water=[],
        landuse=[],
        grid=None,
        real_buildings_nearby=[],
        area_of_context=_rect(-1000, -1000, 1000, 1000),
    )
    return replace(result, style=style)


def _generate(seed=1, *, feedback=None, real=(), fingerprint=FINGERPRINT, style=SettlementStyle.REGULAR, grid=None):
    return generate_block(
        _block(),
        suitability=_suitability(style),
        fingerprint=fingerprint,
        reference_block_id=None,
        count_source=CountSource.DEFAULT,
        feedback=feedback,
        rng=random.Random(f"{seed}:{uuid.UUID(int=1)}"),
        grid=grid,
        real_footprints=list(real),
        projection=PROJECTION,
    )


def _wkts(result):
    return [footprint.polygon.wkt for footprint in result.footprints]


def test_the_same_seed_gives_identical_footprints_and_another_seed_gives_different_ones():
    first = _generate(seed=1)

    assert len(first.footprints) > 4
    assert _wkts(first) == _wkts(_generate(seed=1))
    assert _wkts(first) != _wkts(_generate(seed=2))


def test_footprints_lie_in_the_suitable_ground_outside_the_setback_and_clear_of_each_other():
    result = _generate()
    setback = [zone for reason, zone in result.suitability.zones if reason is ZoneReason.SETBACK]
    polygons = [footprint.polygon for footprint in result.footprints]

    assert len(setback) == 1
    assert all(result.suitability.suitable.covers(polygon) for polygon in polygons)
    assert all(polygon.intersection(setback[0]).area < 1e-6 for polygon in polygons)
    assert all(polygon.area >= 15.0 for polygon in polygons)
    assert not any(a.intersects(b) for index, a in enumerate(polygons) for b in polygons[index + 1:])


def test_the_setback_zone_is_the_four_metre_band_inside_the_buildable_area():
    result = _generate()
    setback = next(zone for reason, zone in result.suitability.zones if reason is ZoneReason.SETBACK)

    assert setback.area == pytest.approx(80 * 60 - 72 * 52, abs=0.01)


def test_footprints_keep_off_real_buildings():
    real = box(30, 0, 50, 25)

    with_real = _generate(real=[real])

    assert len(with_real.footprints) < len(_generate().footprints)
    assert not any(footprint.polygon.intersects(real) for footprint in with_real.footprints)


def test_levels_height_and_the_ground_come_from_the_fingerprint_and_grid():
    grid = ElevationGrid(Coordinate(-0.01, -0.01), 0.01, 0.01, 3, 3, (12.5,) * 9)

    flat = _generate()
    on_ground = _generate(grid=grid)

    assert {footprint.levels for footprint in flat.footprints} == {2}
    assert {footprint.height_meters for footprint in flat.footprints} == {6.0}
    assert {footprint.base_elevation_meters for footprint in flat.footprints} == {None}
    elevations = {footprint.base_elevation_meters for footprint in on_ground.footprints}
    assert len(elevations) == 1
    assert next(iter(elevations)) == pytest.approx(12.5)


def test_a_feedback_count_gives_exactly_that_many_in_walk_order_from_the_same_lots():
    everything = _generate()
    lots = everything.lot_count
    assert lots > 5

    result = _generate(feedback=BlockFeedback(uuid.UUID(int=1), AREA_ID, building_count=5))

    assert len(result.footprints) == 5 and result.shortfall == 0 and result.lot_count == lots
    assert {footprint.count_source for footprint in result.footprints} == {CountSource.FEEDBACK}
    assert set(_wkts(result)) <= set(_wkts(everything))
    walk = _wkts(everything)
    assert [walk.index(wkt) for wkt in _wkts(result)] == sorted(walk.index(wkt) for wkt in _wkts(result))


def test_feedback_asking_for_more_than_fits_generates_what_fits_and_reports_the_shortfall():
    lots = _generate().lot_count

    result = _generate(feedback=BlockFeedback(uuid.UUID(int=1), AREA_ID, building_count=lots + 7))

    assert len(result.footprints) == lots and result.shortfall == 7


def test_no_buildings_feedback_generates_nothing_but_still_counts_the_lots():
    result = _generate(feedback=BlockFeedback(uuid.UUID(int=1), AREA_ID, no_buildings=True))

    assert result.footprints == () and result.shortfall == 0 and result.lot_count > 0


def test_informal_blocks_get_turned_footprints_and_the_others_stay_square_to_the_edge():
    informal = _generate(style=SettlementStyle.INFORMAL, fingerprint=default_fingerprint(RoadClassGroup.LOCAL, SettlementStyle.INFORMAL))
    regular = _generate()

    def slack(footprint):
        polygon: ShapelyPolygon = footprint.polygon
        return polygon.envelope.area - polygon.area

    assert informal.footprints and any(slack(footprint) > 0.01 for footprint in informal.footprints)
    assert all(slack(footprint) < 1e-6 for footprint in regular.footprints)
