"""Measuring a block's real buildings against its street frontage, so a nearly complete block can
be a reference for others (contract 4). Everything is in local metres."""

import math
from collections.abc import Sequence
from dataclasses import dataclass

import shapely
from shapely.geometry import LineString, Point
from shapely.geometry import Polygon as ShapelyPolygon

from app.domain.block import Block
from app.domain.building import Building
from app.domain.generation import (
    BlockEligibility,
    BuildingMeasure,
    Fingerprint,
    SettlementStyle,
    coverage_ratio,
    eligibility,
    fingerprint_of,
    qualifies_as_exemplar,
    union_length,
)
from app.domain.local_projection import LocalProjection, local_projection_for
from app.generation.geometry import multipolygon_to_local, polygon_to_local, polygons_of

_MIN_EDGE_METERS = 1e-6
_DENSIFY_METERS = 1.0
# Outline points within this of the building's nearest approach to the ring face the street.
_FRONT_BAND_METERS = 5.0
# Projected points farther apart than this along the ring start a new run.
_RUN_BREAK_METERS = 5.0
_TANGENT_HALF_SPAN_METERS = 0.5
# A building farther than this from the curb line is interior, not frontage.
_FRONTAGE_REACH_METERS = 25.0


@dataclass(frozen=True)
class Edge:
    start: tuple[float, float]
    end: tuple[float, float]

    @property
    def length(self) -> float:
        return math.dist(self.start, self.end)

    @property
    def line(self) -> LineString:
        return LineString([self.start, self.end])


@dataclass(frozen=True)
class BlockMeasurement:
    """A block's real buildings against its frontage."""

    frontage_m: float
    measures: tuple[BuildingMeasure, ...]
    side_gaps: tuple[float, ...]
    coverage: float


def frontage_edges(buildable_local: Sequence[ShapelyPolygon]) -> list[Edge]:
    """The straight edges of the buildable area's exterior rings: the street-front line. Polygons
    are taken in position order and edges in ring order, so the result is stable."""
    edges: list[Edge] = []
    for polygon in sorted(buildable_local, key=lambda polygon: polygon.bounds[:2]):
        coords = list(polygon.exterior.coords)
        for start, end in zip(coords, coords[1:]):
            edge = Edge((start[0], start[1]), (end[0], end[1]))
            if edge.length > _MIN_EDGE_METERS:
                edges.append(edge)
    return edges


def frontage_rings(buildable_local: Sequence[ShapelyPolygon]) -> list[LineString]:
    """The exterior rings of the buildable area (the curb line), one per polygon, in the same
    position order as `frontage_edges`. Each is a closed line, so `project` gives a position along
    the whole ring however many short edges buffering split it into."""
    return [
        LineString(polygon.exterior.coords)
        for polygon in sorted(buildable_local, key=lambda polygon: polygon.bounds[:2])
        if polygon.exterior.length > _MIN_EDGE_METERS
    ]


def frontage_length(edges: Sequence[Edge]) -> float:
    return sum(edge.length for edge in edges)


def _runs_along(ring: LineString, footprint: ShapelyPolygon, near: float) -> list[tuple[float, float]]:
    """The footprint's frontage runs along the closed `ring`, as (start, end) with start in
    [0, length) and end past the length when a run straddles the ring's start. The outline is
    densified, only points within `_FRONT_BAND_METERS` of its nearest approach to the ring are
    projected (so the far corner of a deep house near a street corner stays out), and the sorted
    positions are cut into runs wherever neighbours are more than `_RUN_BREAK_METERS` apart, round
    the ring's start included. A corner building is one run; a through-block building is two."""
    length = ring.length
    outline = [Point(x, y) for x, y in shapely.segmentize(footprint.exterior, _DENSIFY_METERS).coords]
    positions = sorted(
        ring.project(point) % length for point in outline if ring.distance(point) <= near + _FRONT_BAND_METERS
    )
    count = len(positions)
    gaps = [positions[(index + 1) % count] - positions[index] + (length if index == count - 1 else 0.0) for index in range(count)]
    breaks = [index for index, gap in enumerate(gaps) if gap > _RUN_BREAK_METERS]
    if not breaks:
        return [(0.0, length)]
    runs = []
    for position, index in enumerate(breaks):
        first = (index + 1) % count  # the run begins after a break
        last = breaks[(position + 1) % len(breaks)]
        start, end = positions[first], positions[last]
        if end < start or (end == start and first != last):
            end += length
        runs.append((start, end))
    return runs


def measure_building(footprint: ShapelyPolygon, rings: Sequence[LineString], levels: int | None = None) -> BuildingMeasure:
    """`footprint` against the nearest frontage ring (the lowest index on a tie). `runs` are its
    stretches along that ring; `start_m`, `end_m` and `width_m` describe the longest, its main
    frontage (`end_m` runs past the ring's length when it straddles the ring's start).
    `front_setback_m` is the distance to the ring, and `depth_m` the extent across the ring at the
    middle of the main run."""
    ring_index = min(range(len(rings)), key=lambda index: (footprint.distance(rings[index]), index))
    ring = rings[ring_index]
    length = ring.length
    setback = footprint.distance(ring)
    runs = _runs_along(ring, footprint, setback)
    start, end = max(runs, key=lambda run: run[1] - run[0])
    width = end - start
    middle = (start + width / 2) % length
    before = ring.interpolate((middle - _TANGENT_HALF_SPAN_METERS) % length)
    after = ring.interpolate((middle + _TANGENT_HALF_SPAN_METERS) % length)
    tangent = (after.x - before.x, after.y - before.y)
    norm = math.hypot(*tangent)
    if norm > _MIN_EDGE_METERS:
        normal = (-tangent[1] / norm, tangent[0] / norm)
        offsets = [x * normal[0] + y * normal[1] for x, y in footprint.exterior.coords]
        depth = max(offsets) - min(offsets)
    else:
        depth = 0.0
    return BuildingMeasure(
        edge_index=ring_index,
        start_m=start,
        end_m=end,
        width_m=width,
        depth_m=depth,
        front_setback_m=setback,
        area_square_meters=footprint.area,
        levels=levels,
        runs=tuple(runs),
    )


def measure_block(
    block: Block, buildings: Sequence[Building], projection: LocalProjection | None = None
) -> BlockMeasurement | None:
    """None when the block has no buildable area, no frontage, or none of `buildings` can be
    measured. `projection` defaults to one centred on the block. Each building is an interval along
    its nearest frontage ring (`edge_index` is the ring's index). Coverage and the side gaps count
    only buildings within `_FRONTAGE_REACH_METERS` of the ring; farther ones are interior (a back
    building or a courtyard) and count only toward the footprint statistics."""
    if block.buildable_area is None:
        return None
    projection = projection or local_projection_for(block.boundary)
    rings = frontage_rings(polygons_of(multipolygon_to_local(projection, block.buildable_area)))
    frontage_m = sum(ring.length for ring in rings)
    footprints = [
        (polygon_to_local(projection, building.geom), building.levels)
        for building in sorted(buildings, key=lambda building: str(building.id))
    ]
    measures = tuple(
        measure_building(footprint, rings, levels)
        for footprint, levels in footprints
        if not footprint.is_empty and footprint.area > 0
    )
    if not rings or not measures:
        return None

    gaps: list[float] = []
    covered_m = 0.0
    for index, ring in enumerate(rings):
        length = ring.length
        arcs = sorted(
            run
            for measure in measures
            if measure.edge_index == index and measure.front_setback_m <= _FRONTAGE_REACH_METERS
            for run in (measure.runs or ((measure.start_m, measure.end_m),))
        )
        if len(arcs) > 1:
            reached = arcs[0][1]
            for start, end in arcs[1:]:
                gaps.append(max(0.0, start - reached))
                reached = max(reached, end)
            gaps.append(max(0.0, arcs[0][0] + length - reached))  # round the ring's start
        pieces = []
        for start, end in arcs:
            pieces.append((start, min(end, length)))
            if end > length:
                pieces.append((0.0, end - length))
        covered_m += union_length(pieces)
    return BlockMeasurement(frontage_m, measures, tuple(float(gap) for gap in gaps), coverage_ratio(float(covered_m), float(frontage_m)))


def fingerprint(
    block: Block,
    buildings: Sequence[Building],
    *,
    style: SettlementStyle = SettlementStyle.REGULAR,
    projection: LocalProjection | None = None,
) -> Fingerprint | None:
    """The block's fingerprint from its real buildings, or None when none can be measured. It says
    nothing about whether the block is an exemplar: see `is_exemplar`."""
    measurement = measure_block(block, buildings, projection)
    if measurement is None:
        return None
    return fingerprint_of(measurement.measures, measurement.side_gaps, measurement.coverage, style)


def is_exemplar(block: Block, buildings: Sequence[Building], projection: LocalProjection | None = None) -> bool:
    """An eligible block whose buildings cover at least 70% of its frontage, with at least three."""
    if eligibility(block) is not BlockEligibility.ELIGIBLE:
        return False
    measurement = measure_block(block, buildings, projection)
    return measurement is not None and qualifies_as_exemplar(
        BlockEligibility.ELIGIBLE, measurement.coverage, len(measurement.measures)
    )
