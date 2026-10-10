"""Pure rules for generating buildings in a block: which blocks are eligible, and (further down)
fingerprints, defaults and matching. No shapely, no database."""

import enum

from app.domain.block import Block

MIN_GENERATION_BUILDABLE_SQUARE_METERS = 30.0


class BlockEligibility(str, enum.Enum):
    ELIGIBLE = "eligible"
    CLIPPED = "clipped"
    MEDIAN = "median"
    NO_BUILDABLE_AREA = "no_buildable_area"


def eligibility(block: Block) -> BlockEligibility:
    """Whether generation may build on a block. The first reason that applies wins: clipped,
    then median, then no usable buildable area."""
    if block.is_clipped:
        return BlockEligibility.CLIPPED
    if block.is_median:
        return BlockEligibility.MEDIAN
    if block.buildable_area is None or block.buildable_area_square_meters < MIN_GENERATION_BUILDABLE_SQUARE_METERS:
        return BlockEligibility.NO_BUILDABLE_AREA
    return BlockEligibility.ELIGIBLE
