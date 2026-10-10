"""Pure rules for generating buildings in a block: which blocks are eligible, and (further down)
fingerprints, defaults and matching. No shapely, no database."""

import enum
import hashlib
import math
import random
import statistics
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.domain.block import Block
from app.domain.enums import RoadClassification
from app.domain.geometry import MultiPolygon, Polygon

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


# Matching a block to its local reference (contract 5).
REFERENCE_RADIUS_METERS = 500.0


@dataclass(frozen=True)
class MatchProfile:
    """What matching compares between two blocks. `area_square_meters` is the block's own area."""

    road_class_group: RoadClassGroup
    area_square_meters: float
    style: SettlementStyle


@dataclass(frozen=True)
class ReferenceCandidate:
    """An exemplar block near the block being matched."""

    block_id: uuid.UUID
    distance_m: float
    profile: MatchProfile


def match_score(subject: MatchProfile, candidate: ReferenceCandidate) -> float:
    """Lower is better: distance as a share of the 500 m radius, plus 1 for a different road class
    group, plus the log ratio of the two areas, plus 1 for a different style."""
    area_ratio = abs(math.log(subject.area_square_meters / candidate.profile.area_square_meters))
    return (
        candidate.distance_m / REFERENCE_RADIUS_METERS
        + (0.0 if subject.road_class_group is candidate.profile.road_class_group else 1.0)
        + area_ratio
        + (0.0 if subject.style is candidate.profile.style else 1.0)
    )


def best_reference(subject: MatchProfile, candidates: Iterable[ReferenceCandidate]) -> ReferenceCandidate | None:
    """The lowest-scoring candidate within 500 m, ties broken by block id; None when there is none,
    and the block takes `default_fingerprint` instead."""
    in_range = [candidate for candidate in candidates if candidate.distance_m <= REFERENCE_RADIUS_METERS]
    if not in_range:
        return None
    return min(in_range, key=lambda candidate: (match_score(subject, candidate), str(candidate.block_id)))


# Stored generation: runs, generated buildings, zones and feedback (contract 7).
ALGORITHM_VERSION = "frontage-lots-v1"


class CountSource(str, enum.Enum):
    """Why a block has the number of generated buildings it has."""

    REFERENCE = "reference"  # the fingerprint of a matched exemplar
    DEFAULT = "default"  # the road-class defaults, no exemplar was near
    FEEDBACK = "feedback"  # a person said how many


def road_graph_hash(block_ids: Iterable[uuid.UUID]) -> str:
    """The sha256 of an area's own block ids, sorted and newline-joined. A run is stale (roads
    changed) once the area's current hash differs: a re-import that adds, removes or re-derives
    a block changes the ids."""
    joined = "\n".join(sorted(str(block_id) for block_id in block_ids))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


class StaleReason(str, enum.Enum):
    ROADS_CHANGED = "roads_changed"
    TERRAIN_CHANGED = "terrain_changed"


def stale_reasons(
    *,
    run_road_graph_hash: str,
    current_road_graph_hash: str,
    run_elevation_version: int | None,
    current_elevation_version: int | None,
) -> list[StaleReason]:
    reasons: list[StaleReason] = []
    if run_road_graph_hash != current_road_graph_hash:
        reasons.append(StaleReason.ROADS_CHANGED)
    if run_elevation_version != current_elevation_version:
        reasons.append(StaleReason.TERRAIN_CHANGED)
    return reasons


def fingerprint_to_dict(value: Fingerprint) -> dict[str, Any]:
    """The JSON stored for a fingerprint."""

    def pair(item: Spread) -> dict[str, float]:
        return {"median": item.median, "iqr": item.iqr}

    return {
        "width": pair(value.width),
        "depth": pair(value.depth),
        "front_setback": pair(value.front_setback),
        "side_gap": pair(value.side_gap),
        "median_levels": value.median_levels,
        "coverage": value.coverage,
        "style": value.style.value,
    }


def fingerprint_from_dict(data: Mapping[str, Any]) -> Fingerprint:
    def pair(key: str) -> Spread:
        return Spread(float(data[key]["median"]), float(data[key]["iqr"]))

    return Fingerprint(
        width=pair("width"),
        depth=pair("depth"),
        front_setback=pair("front_setback"),
        side_gap=pair("side_gap"),
        median_levels=data["median_levels"],
        coverage=data["coverage"],
        style=SettlementStyle(data["style"]),
    )


@dataclass(frozen=True)
class GeneratedBuilding:
    """A building the generator placed. Never a measured one: it lives apart from `Building`."""

    id: uuid.UUID | None
    run_id: uuid.UUID | None
    block_id: uuid.UUID
    geom: Polygon
    height_meters: float
    levels: int
    base_elevation_meters: float | None
    style: SettlementStyle
    reference_block_id: uuid.UUID | None
    count_source: CountSource
    # The area whose run placed it; filled when read back.
    import_area_id: uuid.UUID | None = None


@dataclass(frozen=True)
class GenerationZone:
    """A part of a block that generation kept clear, for display."""

    id: uuid.UUID | None
    run_id: uuid.UUID | None
    block_id: uuid.UUID
    reason: ZoneReason
    geom: MultiPolygon


@dataclass(frozen=True)
class BlockAssignment:
    """What generation decided for one eligible block: its style, the exemplar it learned from
    (None for defaults), how many lots the algorithm found before any feedback applied, and the
    calibration ratio applied to its lot width (None when none was)."""

    style: SettlementStyle
    reference_block_id: uuid.UUID | None
    lot_count: int
    calibration_ratio: float | None = None


@dataclass(frozen=True)
class GenerationRun:
    """A stored run, as read back. `parameters` holds what the run used: thresholds, the
    calibration ratio, the eligible block count, the blocks that fell short of their feedback count,
    and a `blocks` mapping from block id to its `BlockAssignment` as JSON."""

    id: uuid.UUID
    import_area_id: uuid.UUID
    seed: int
    algorithm_version: str
    parameters: Mapping[str, Any]
    elevation_version: int | None
    road_graph_hash: str
    building_count: int
    block_count: int
    created_at: datetime

    @property
    def eligible_block_count(self) -> int:
        return int(self.parameters.get("eligible_block_count", 0))

    @property
    def calibration_ratio(self) -> float | None:
        return self.parameters.get("calibration_ratio")

    @property
    def feedback_shortfall_block_ids(self) -> list[uuid.UUID]:
        return [uuid.UUID(value) for value in self.parameters.get("feedback_shortfall_block_ids", [])]

    def assignments(self) -> dict[uuid.UUID, BlockAssignment]:
        result: dict[uuid.UUID, BlockAssignment] = {}
        for block_id, item in self.parameters.get("blocks", {}).items():
            reference = item.get("reference_block_id")
            result[uuid.UUID(block_id)] = BlockAssignment(
                style=SettlementStyle(item["style"]),
                reference_block_id=uuid.UUID(reference) if reference else None,
                lot_count=int(item["lot_count"]),
                calibration_ratio=item.get("calibration_ratio"),
            )
        return result


@dataclass(frozen=True)
class NewGenerationRun:
    """A run to store: the same fields as `GenerationRun` without the ones the database assigns."""

    import_area_id: uuid.UUID
    seed: int
    parameters: Mapping[str, Any]
    elevation_version: int | None
    road_graph_hash: str
    building_count: int
    block_count: int
    algorithm_version: str = ALGORITHM_VERSION


class InvalidBlockFeedback(ValueError):
    pass


@dataclass(frozen=True)
class BlockFeedback:
    """What a person says about a block: how many buildings it really has, or that it has none.
    Exactly one of the two."""

    block_id: uuid.UUID
    import_area_id: uuid.UUID
    building_count: int | None = None
    no_buildings: bool = False
    updated_at: datetime | None = None

    def __post_init__(self) -> None:
        if (self.building_count is None) == (not self.no_buildings):
            raise InvalidBlockFeedback("exactly one of building_count and no_buildings must be set")
        if self.building_count is not None and self.building_count < 0:
            raise InvalidBlockFeedback("building_count must be 0 or more")

    @property
    def target_count(self) -> int:
        """The number of buildings the feedback asks for."""
        return 0 if self.no_buildings else int(self.building_count or 0)


@dataclass(frozen=True)
class StoredBlockFeedback:
    """Feedback as listed for an area. `orphaned` when its block no longer exists."""

    feedback: BlockFeedback
    orphaned: bool = field(default=False)


# Generating lots (contract 6).
MIN_FOOTPRINT_SQUARE_METERS = 15.0
LEVEL_HEIGHT_METERS = 3.0
IQR_TO_SIGMA = 1.35
LOT_CLAMP_LOW, LOT_CLAMP_HIGH = 0.5, 1.5  # a sampled dimension stays within these times its median
INFORMAL_ROTATION_DEGREES = 8.0
INFORMAL_OFFSET_METERS = 1.0
CALIBRATION_MIN_BLOCKS = 2
CALIBRATION_CLAMP_LOW, CALIBRATION_CLAMP_HIGH = 0.5, 2.0
CALIBRATION_RADIUS_METERS = 500.0


def sample_dimension(rng: random.Random, value: Spread) -> float:
    """A normal draw with the median as its mean and IQR / 1.35 as its sigma, kept within
    [0.5, 1.5] times the median. Always consumes one draw, so the sequence of draws doesn't depend
    on how large the numbers are."""
    sigma = value.iqr / IQR_TO_SIGMA
    drawn = rng.gauss(value.median, sigma)
    return min(max(drawn, LOT_CLAMP_LOW * value.median), LOT_CLAMP_HIGH * value.median)


def evenly_spaced_indices(total: int, count: int) -> list[int]:
    """`count` distinct indices into `total` items, spread evenly and in order; every index when
    `count >= total`."""
    if count >= total:
        return list(range(total))
    return [int((position + 0.5) * total / count) for position in range(count)]


def levels_of(fingerprint: Fingerprint) -> int:
    """Whole storeys from the fingerprint's median levels; at least one."""
    return max(1, round(fingerprint.median_levels)) if fingerprint.median_levels is not None else 1


def calibration_factor(feedback_counts: Sequence[int], generated_counts: Sequence[int]) -> float | None:
    """The clamped ratio of what people reported to what the previous run generated, over blocks
    that had both; None when fewer than two blocks, or when nothing was generated there. Lot widths
    are divided by it: more real buildings than generated means narrower lots."""
    if len(feedback_counts) < CALIBRATION_MIN_BLOCKS or len(feedback_counts) != len(generated_counts):
        return None
    generated = sum(generated_counts)
    if generated <= 0:
        return None
    ratio = sum(feedback_counts) / generated
    return min(max(ratio, CALIBRATION_CLAMP_LOW), CALIBRATION_CLAMP_HIGH)


def with_narrower_lots(fingerprint: Fingerprint, factor: float) -> Fingerprint:
    """The fingerprint with its lot width (median and spread) divided by `factor`."""
    return Fingerprint(
        width=Spread(fingerprint.width.median / factor, fingerprint.width.iqr / factor),
        depth=fingerprint.depth,
        front_setback=fingerprint.front_setback,
        side_gap=fingerprint.side_gap,
        median_levels=fingerprint.median_levels,
        coverage=fingerprint.coverage,
        style=fingerprint.style,
    )
