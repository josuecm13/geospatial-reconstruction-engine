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
    assert 0.80 < measurement.coverage < 0.90  # corner houses count toward only one of their two edges
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
