"""Pure rules for generating buildings in a block: which blocks are eligible, and (further down)
fingerprints, defaults and matching. No shapely, no database."""

import enum

from app.domain.block import Block

MIN_GENERATION_BUILDABLE_SQUARE_METERS = 30.0

# Suitability (contract 3).
WATER_BUFFER_METERS = 20.0
STEEP_SLOPE = 0.30  # rise over run, as a ratio
INFORMAL_WATER_DISTANCE_METERS = 150.0
INFORMAL_HEIGHT_ABOVE_WATER_METERS = 2.0
STYLE_CONTEXT_RADIUS_METERS = 500.0
SPARSE_COVERAGE_BELOW = 0.05


class SettlementStyle(str, enum.Enum):
    REGULAR = "regular"
    SPARSE = "sparse"
    INFORMAL = "informal"


class ZoneReason(str, enum.Enum):
    WATER = "water"
    STEEP = "steep"
    LANDUSE = "landuse"
    SETBACK = "setback"


def settlement_style(
    *,
    near_low_water: bool,
    building_coverage: float,
) -> SettlementStyle:
    """`informal` wins over `sparse`, which wins over `regular`. `near_low_water` is false whenever
    there is no elevation, so `informal` is never chosen without it."""
    if near_low_water:
        return SettlementStyle.INFORMAL
    if building_coverage < SPARSE_COVERAGE_BELOW:
        return SettlementStyle.SPARSE
    return SettlementStyle.REGULAR


def is_near_low_water(distance_to_water_m: float, height_above_water_m: float) -> bool:
    return (
        distance_to_water_m <= INFORMAL_WATER_DISTANCE_METERS
        and height_above_water_m < INFORMAL_HEIGHT_ABOVE_WATER_METERS
    )


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
