"""Pure rules for generating buildings in a block: which blocks are eligible, and (further down)
fingerprints, defaults and matching. No shapely, no database."""

import enum
import statistics
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from app.domain.block import Block
from app.domain.enums import RoadClassification

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


# Reference blocks and fingerprints (contract 4).
EXEMPLAR_MIN_COVERAGE = 0.70
EXEMPLAR_MIN_BUILDINGS = 3
# The contract gives defaults as medians only. Their spread is a fixed share of the median, so the
# generator's sampling (sigma = IQR / 1.35) still varies lots a little when there is no exemplar.
DEFAULT_IQR_FRACTION = 0.2
SPARSE_GAP_MULTIPLIER = 4.0


@dataclass(frozen=True)
class Spread:
    median: float
    iqr: float


@dataclass(frozen=True)
class Fingerprint:
    """What the buildings of a block look like, in metres. `coverage` is the share of the frontage
    the buildings cover: None for defaults, which were not measured."""

    width: Spread
    depth: Spread
    front_setback: Spread
    side_gap: Spread
    median_levels: float | None
    coverage: float | None
    style: SettlementStyle


@dataclass(frozen=True)
class BuildingMeasure:
    """One real building against its nearest frontage edge. `start_m` and `end_m` are its extent
    along that edge, measured from the edge's start (they can run past either end)."""

    edge_index: int
    start_m: float
    end_m: float
    width_m: float
    depth_m: float
    front_setback_m: float
    area_square_meters: float
    levels: int | None


def median(values: Sequence[float]) -> float:
    return float(statistics.median(values))


def iqr(values: Sequence[float]) -> float:
    """The interquartile range (inclusive quartiles); 0 for fewer than two values."""
    if len(values) < 2:
        return 0.0
    first, _, third = statistics.quantiles(values, n=4, method="inclusive")
    return float(third - first)


def spread(values: Sequence[float]) -> Spread:
    return Spread(median(values), iqr(values))


def union_length(intervals: Iterable[tuple[float, float]]) -> float:
    """The total length covered by a set of (start, end) intervals, overlaps counted once."""
    total = 0.0
    current_end: float | None = None
    for start, end in sorted(intervals):
        if current_end is None or start > current_end:
            total += end - start
            current_end = end
        elif end > current_end:
            total += end - current_end
            current_end = end
    return total


def side_gaps(intervals: Iterable[tuple[float, float]]) -> list[float]:
    """The gaps between neighbours along one edge, from their (start, end) intervals: each interval
    to the furthest end reached before it, floored at 0 (0 means attached or overlapping)."""
    gaps: list[float] = []
    reached: float | None = None
    for start, end in sorted(intervals):
        if reached is not None:
            gaps.append(max(0.0, start - reached))
        reached = end if reached is None else max(reached, end)
    return gaps


def coverage_ratio(covered_m: float, frontage_m: float) -> float:
    return covered_m / frontage_m if frontage_m > 0 else 0.0


def qualifies_as_exemplar(block_eligibility: BlockEligibility, coverage: float, building_count: int) -> bool:
    return (
        block_eligibility is BlockEligibility.ELIGIBLE
        and coverage >= EXEMPLAR_MIN_COVERAGE
        and building_count >= EXEMPLAR_MIN_BUILDINGS
    )


def fingerprint_of(
    measures: Sequence[BuildingMeasure], gaps: Sequence[float], coverage: float, style: SettlementStyle
) -> Fingerprint:
    """The medians and spreads of a block's measured buildings. Without any gap (one building per
    edge) the side gap is 0."""
    levels = [measure.levels for measure in measures if measure.levels is not None]
    return Fingerprint(
        width=spread([measure.width_m for measure in measures]),
        depth=spread([measure.depth_m for measure in measures]),
        front_setback=spread([measure.front_setback_m for measure in measures]),
        side_gap=spread(list(gaps)) if gaps else Spread(0.0, 0.0),
        median_levels=median(levels) if levels else None,
        coverage=coverage,
        style=style,
    )


class RoadClassGroup(str, enum.Enum):
    """How built-up a road's frontage is expected to be."""

    LOCAL = "local"  # residential, unclassified, living street
    COLLECTOR = "collector"  # tertiary, secondary
    ARTERIAL = "arterial"  # primary, trunk


# Weakest to strongest. Service roads and motorways are not in the contract's table: a service road
# counts as the weakest local road, and a motorway as an arterial.
_ROAD_STRENGTH = [
    RoadClassification.SERVICE,
    RoadClassification.UNCLASSIFIED,
    RoadClassification.RESIDENTIAL,
    RoadClassification.TERTIARY,
    RoadClassification.SECONDARY,
    RoadClassification.PRIMARY,
    RoadClassification.TRUNK,
    RoadClassification.MOTORWAY,
]
_ROAD_GROUPS = {
    RoadClassification.SERVICE: RoadClassGroup.LOCAL,
    RoadClassification.UNCLASSIFIED: RoadClassGroup.LOCAL,
    RoadClassification.RESIDENTIAL: RoadClassGroup.LOCAL,
    RoadClassification.TERTIARY: RoadClassGroup.COLLECTOR,
    RoadClassification.SECONDARY: RoadClassGroup.COLLECTOR,
    RoadClassification.PRIMARY: RoadClassGroup.ARTERIAL,
    RoadClassification.TRUNK: RoadClassGroup.ARTERIAL,
    RoadClassification.MOTORWAY: RoadClassGroup.ARTERIAL,
}


def road_class_group(classification: RoadClassification) -> RoadClassGroup:
    return _ROAD_GROUPS[classification]


def strongest_road_group(classifications: Iterable[RoadClassification]) -> RoadClassGroup:
    """The group of the strongest road bounding a block; LOCAL when none is known."""
    strongest = max(classifications, key=_ROAD_STRENGTH.index, default=None)
    return RoadClassGroup.LOCAL if strongest is None else road_class_group(strongest)


# group -> (width, depth, front setback, side gap, levels)
_DEFAULTS = {
    RoadClassGroup.LOCAL: (10.0, 12.0, 4.0, 3.0, 2),
    RoadClassGroup.COLLECTOR: (14.0, 16.0, 2.0, 1.0, 3),
    RoadClassGroup.ARTERIAL: (18.0, 20.0, 1.0, 0.0, 5),
}
_INFORMAL_DEFAULTS = (6.0, 7.0, 0.5, 0.5, 1)


def default_fingerprint(group: RoadClassGroup, style: SettlementStyle) -> Fingerprint:
    """What to build where no exemplar is near. `sparse` stretches the side gap four times;
    `informal` replaces the road class's numbers with small, close-set houses."""
    width, depth, setback, gap, levels = _INFORMAL_DEFAULTS if style is SettlementStyle.INFORMAL else _DEFAULTS[group]
    if style is SettlementStyle.SPARSE:
        gap *= SPARSE_GAP_MULTIPLIER

    def fixed(value: float) -> Spread:
        return Spread(value, value * DEFAULT_IQR_FRACTION)

    return Fingerprint(
        width=fixed(width),
        depth=fixed(depth),
        front_setback=fixed(setback),
        side_gap=fixed(gap),
        median_levels=float(levels),
        coverage=None,
        style=style,
    )
