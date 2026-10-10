import uuid

import pytest

from app.domain.block import Block
from app.domain.bounding_box import Coordinate
from app.domain.generation import BlockEligibility, eligibility

_RING = (Coordinate(0, 0), Coordinate(0, 1), Coordinate(1, 1), Coordinate(0, 0))


def _block(**overrides) -> Block:
    fields = dict(
        id=uuid.uuid4(),
        import_area_id=uuid.uuid4(),
        boundary=_RING,
        area_square_meters=1000.0,
        buildable_area=(_RING,),
        buildable_area_square_meters=500.0,
    )
    fields.update(overrides)
    return Block(**fields)


def test_a_whole_block_with_room_is_eligible():
    assert eligibility(_block()) is BlockEligibility.ELIGIBLE


def test_clipped_wins_over_every_other_reason():
    block = _block(is_clipped=True, is_median=True, buildable_area=None)
    assert eligibility(block) is BlockEligibility.CLIPPED


def test_median_wins_over_no_buildable_area():
    assert eligibility(_block(is_median=True, buildable_area=None)) is BlockEligibility.MEDIAN


@pytest.mark.parametrize("area", [None, ()])
def test_no_buildable_area(area):
    block = _block(buildable_area=area, buildable_area_square_meters=0.0)
    expected = BlockEligibility.NO_BUILDABLE_AREA
    assert eligibility(block) is expected


def test_buildable_area_under_30_square_meters_is_not_eligible():
    assert eligibility(_block(buildable_area_square_meters=29.9)) is BlockEligibility.NO_BUILDABLE_AREA
    assert eligibility(_block(buildable_area_square_meters=30.0)) is BlockEligibility.ELIGIBLE
