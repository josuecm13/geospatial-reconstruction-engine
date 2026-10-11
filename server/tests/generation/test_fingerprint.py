import math
import uuid

import pytest

from app.domain.block import Block
from app.domain.bounding_box import Coordinate
from app.domain.building import Building
from app.domain.enums import BuildingCategory
from app.domain.generation import SettlementStyle
from app.domain.local_projection import local_projection_for
from app.generation.fingerprint import fingerprint, is_exemplar, measure_block
from app.generation.geometry import from_local_xy

AREA_ID = uuid.uuid4()
SEED_RING = (Coordinate(0.0, 0.0), Coordinate(0.0, 0.001), Coordinate(0.001, 0.001), Coordinate(0.001, 0.0), Coordinate(0.0, 0.0))
PROJECTION = local_projection_for(SEED_RING)


def _rect(x0, y0, x1, y1):
    """A closed ring from metres in the test projection."""
    return tuple(from_local_xy(PROJECTION, x, y) for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)])


def _block(width, height, **overrides):
    fields = dict(
        id=uuid.uuid4(),
        import_area_id=AREA_ID,
        boundary=_rect(-5, -5, width + 5, height + 5),
        area_square_meters=(width + 10) * (height + 10),
        buildable_area=(_rect(0, 0, width, height),),
        buildable_area_square_meters=width * height,
    )
    fields.update(overrides)
    return Block(**fields)


def _house(x0, y0, x1, y1, levels=None):
    return Building(
        id=uuid.uuid4(),
        import_area_id=AREA_ID,
        source_id=f"way/{uuid.uuid4()}",
        category=BuildingCategory.RESIDENTIAL,
        geom=_rect(x0, y0, x1, y1),
        levels=levels,
    )


def _ring_of_houses():
    """A 40 m square block, built up all the way round: five 8 m houses along the south and north
    edges, three along the east and west between them. The corners are on the south and north rows."""
    houses = []
    for index in range(5):
        houses.append(_house(8 * index, 0, 8 * index + 8, 6, levels=2))
        houses.append(_house(8 * index, 34, 8 * index + 8, 40, levels=2))
    for index in range(3):
        y0 = 6 + 28 / 3 * index
        houses.append(_house(0, y0, 6, y0 + 28 / 3, levels=2))
        houses.append(_house(34, y0, 40, y0 + 28 / 3, levels=2))
    return houses


def test_a_built_up_block_is_an_exemplar_with_attached_houses():
    block = _block(40, 40)
    houses = _ring_of_houses()

    measurement = measure_block(block, houses)

    assert measurement is not None
    assert measurement.frontage_m == pytest.approx(160.0, abs=0.01)
    assert measurement.coverage == pytest.approx(1.0, abs=0.01)  # measured round the whole ring, corners included
    assert all(gap == pytest.approx(0.0, abs=0.01) for gap in measurement.side_gaps)
    assert is_exemplar(block, houses) is True
    result = fingerprint(block, houses, style=SettlementStyle.REGULAR)
    assert result is not None
    assert result.side_gap.median == pytest.approx(0.0, abs=0.01)
    assert result.front_setback.median == pytest.approx(0.0, abs=0.01)
    assert result.median_levels == 2.0
    assert result.coverage == measurement.coverage


def test_detached_houses_give_a_gap_equal_to_the_spacing():
    block = _block(100, 40)
    # Six metres wide, set 3 m back, with 2 m between neighbours.
    houses = [_house(10 + 8 * index, 3, 16 + 8 * index, 11) for index in range(5)]

    result = fingerprint(block, houses)

    assert result is not None
    assert result.side_gap.median == pytest.approx(2.0, abs=0.01)
    assert result.front_setback.median == pytest.approx(3.0, abs=0.01)
    assert result.width.median == pytest.approx(6.0, abs=0.01)
    assert result.depth.median == pytest.approx(8.0, abs=0.01)
    assert result.median_levels is None
    assert is_exemplar(block, houses) is False  # five houses, but they cover a fraction of the frontage


def test_two_buildings_are_never_an_exemplar():
    block = _block(40, 40)
    houses = _ring_of_houses()[:2]

    assert is_exemplar(block, houses) is False


def test_a_block_with_no_buildings_has_no_fingerprint():
    assert fingerprint(_block(40, 40), []) is None


def test_a_clipped_block_is_never_an_exemplar_however_built_up():
    block = _block(40, 40, is_clipped=True)

    assert is_exemplar(block, _ring_of_houses()) is False


def test_a_block_without_a_buildable_area_has_no_fingerprint():
    block = _block(40, 40, buildable_area=None, buildable_area_square_meters=0.0)

    assert fingerprint(block, _ring_of_houses()) is None


def _split_ring(x0, y0, x1, y1, step):
    """The rectangle's ring with a vertex every `step` metres along every side, as buffering leaves
    at road junctions: the same line, many short collinear edges."""
    points = []
    for (ax, ay), (bx, by) in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        count = round(math.hypot(bx - ax, by - ay) / step)
        points += [(ax + (bx - ax) * k / count, ay + (by - ay) * k / count) for k in range(count)]
    points.append(points[0])
    return tuple(from_local_xy(PROJECTION, x, y) for x, y in points)


def test_coverage_is_not_lost_where_the_frontage_ring_is_split_into_short_edges():
    width, height = 100, 10
    block = _block(width, height, buildable_area=(_split_ring(0, 0, width, height, 5),))
    # Eleven 8 m houses abutting along the south and north fronts, every joint off the 5 m edge joints.
    houses = [_house(5 + 8 * index, 0, 13 + 8 * index, 4) for index in range(11)]
    houses += [_house(5 + 8 * index, 6, 13 + 8 * index, 10) for index in range(11)]

    measurement = measure_block(block, houses)

    assert measurement is not None
    assert measurement.frontage_m == pytest.approx(220.0, abs=0.01)
    assert measurement.coverage == pytest.approx(192 / 220, abs=0.01)  # 176 m of the long fronts plus 16 m of the short ends the rows face
    assert [round(measure.width_m, 2) for measure in measurement.measures] == [8.0] * 22


def test_a_corner_building_counts_once_round_the_corner():
    block = _block(40, 40)

    measurement = measure_block(block, [_house(0, 0, 8, 12)])

    assert measurement is not None
    (measure,) = measurement.measures
    assert measure.width_m == pytest.approx(20.0, abs=0.01)  # 12 m up the west side and 8 m along the south
    assert measure.front_setback_m == pytest.approx(0.0, abs=0.01)
    assert measurement.coverage == pytest.approx(20 / 160, abs=0.001)  # once, not once per street


def test_a_building_straddling_the_rings_start_wraps_and_the_wrap_gap_is_measured():
    block = _block(40, 40)
    corner = _house(0, 0, 8, 12)  # the ring starts at this corner
    neighbour = _house(14, 0, 24, 8)

    measurement = measure_block(block, [corner, neighbour])

    assert measurement is not None
    wrapped = max(measurement.measures, key=lambda measure: measure.end_m)
    assert wrapped.end_m > measurement.frontage_m  # runs past the end of the ring, into its start
    assert wrapped.width_m == pytest.approx(20.0, abs=0.01)
    assert sorted(measurement.side_gaps) == pytest.approx([6.0, 100.0], abs=0.01)  # 6 m across the start
    assert measurement.coverage == pytest.approx(38 / 160, abs=0.001)  # the corner's 20, the neighbour's 10 and 8 seen from the east end


def test_houses_behind_the_sidewalk_count_but_a_building_deep_inside_does_not():
    block = _block(100, 100)
    front = _house(40, 7, 50, 15)  # 7 m behind the curb line
    courtyard = _house(40, 30, 50, 38)  # 30 m in

    measurement = measure_block(block, [front, courtyard])

    assert measurement is not None
    assert len(measurement.measures) == 2  # both are buildings of the block
    assert sorted(round(measure.front_setback_m, 2) for measure in measurement.measures) == [7.0, 30.0]
    assert measurement.coverage == pytest.approx(10 / 400, abs=0.001)  # only the front house is frontage
    assert measurement.side_gaps == ()


def test_a_building_belongs_to_the_nearest_of_several_rings():
    first = _rect(0, 0, 40, 40)
    second = _rect(100, 0, 140, 40)
    block = _block(40, 40, buildable_area=(first, second))

    measurement = measure_block(block, [_house(110, 3, 120, 11)])

    assert measurement is not None
    assert measurement.frontage_m == pytest.approx(320.0, abs=0.01)
    assert [measure.edge_index for measure in measurement.measures] == [1]
    assert measurement.coverage == pytest.approx(26 / 320, abs=0.001)  # 10 m on its street, 8 m from each short end


def test_a_through_block_building_is_two_frontage_runs_not_one_giant_one():
    block = _block(100, 60)
    through = _house(40, 2, 70, 58)  # runs the whole depth of the block, fronting both long sides

    measurement = measure_block(block, [through])

    assert measurement is not None
    (measure,) = measurement.measures
    assert len(measure.runs) == 2
    assert measure.width_m == pytest.approx(30.0, abs=0.01)  # its frontage on one street, not half the ring
    assert measure.front_setback_m == pytest.approx(2.0, abs=0.01)
    assert measurement.coverage == pytest.approx(60 / 320, abs=0.001)  # both long sides, neither short end


def test_a_deep_house_near_a_corner_is_one_run_on_its_own_street():
    block = _block(100, 40)

    measurement = measure_block(block, [_house(30, 3, 36, 11)])

    assert measurement is not None
    (measure,) = measurement.measures
    assert len(measure.runs) == 1
    assert measure.width_m == pytest.approx(6.0, abs=0.01)
    assert measurement.coverage == pytest.approx(6 / 280, abs=0.001)  # 30 m from either short end: out of ray reach


def test_a_building_covering_most_of_the_block_is_never_wider_than_its_frontage():
    block = _block(100, 60)

    measurement = measure_block(block, [_house(2, 2, 98, 58)])

    assert measurement is not None
    (measure,) = measurement.measures
    assert measure.width_m == pytest.approx(96.0, abs=0.01)  # the long side; the 2 m uncovered at each corner split the runs
    assert measure.width_m < measurement.frontage_m
    assert [round(end - start) for start, end in sorted(measure.runs)] == [96, 56, 96, 56]
    assert measurement.coverage == pytest.approx(304 / 320, abs=0.001)


def test_a_fully_built_rectangle_has_widths_equal_to_the_house_frontages():
    block = _block(100, 20)
    houses = [_house(10 * index, 0, 10 * index + 10, 5) for index in range(10)]
    houses += [_house(10 * index, 15, 10 * index + 10, 20) for index in range(10)]

    measurement = measure_block(block, houses)

    assert measurement is not None
    # Sixteen houses front only their street; the four at the ends also face the short ends, round the corner.
    assert sorted(round(measure.width_m, 2) for measure in measurement.measures) == [10.0] * 16 + [15.0] * 4
    assert measurement.coverage == pytest.approx(220 / 240, abs=0.001)
