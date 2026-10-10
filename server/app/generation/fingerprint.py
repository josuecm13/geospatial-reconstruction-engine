"""Measuring a block's real buildings against its street frontage, so a nearly complete block can
be a reference for others (contract 4). Everything is in local metres."""

import math
import statistics
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
)
from app.domain.local_projection import LocalProjection, local_projection_for
from app.generation.geometry import multipolygon_to_local, polygon_to_local, polygons_of

_MIN_EDGE_METERS = 1e-6
# Frontage is found by casting a ray inward from a sample every metre along the curb line; the
# first building a ray reaches within `_RAY_METERS` is the one that fronts that stretch.
_SAMPLE_METERS = 1.0
_RAY_METERS = 25.0
_TANGENT_HALF_SPAN_METERS = 0.5
_NORMAL_PROBE_METERS = 0.1


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


def frontage_length(edges: Sequence[Edge]) -> float:
    return sum(edge.length for edge in edges)


@dataclass(frozen=True)
class _Sample:
    point: Point
    normal: tuple[float, float]


def _samples(ring: LineString, polygon: ShapelyPolygon) -> tuple[list[_Sample], float]:
    """Samples every ~1 m along `ring` from its start (offset half a step, so a sample is never on
    a building's edge line), each with the unit normal pointing into `polygon`. Also the spacing."""
    length = ring.length
    count = max(1, round(length / _SAMPLE_METERS))
    spacing = length / count
    samples = []
    for index in range(count):
        position = (index + 0.5) * spacing
        point = ring.interpolate(position)
        before = ring.interpolate((position - _TANGENT_HALF_SPAN_METERS) % length)
        after = ring.interpolate((position + _TANGENT_HALF_SPAN_METERS) % length)
        dx, dy = after.x - before.x, after.y - before.y
        norm = math.hypot(dx, dy)
        if norm <= _MIN_EDGE_METERS:
            dx, dy, norm = 1.0, 0.0, 1.0
        normal = (-dy / norm, dx / norm)
        probe = Point(point.x + normal[0] * _NORMAL_PROBE_METERS, point.y + normal[1] * _NORMAL_PROBE_METERS)
        if not polygon.contains(probe):
            normal = (-normal[0], -normal[1])
        samples.append(_Sample(point, normal))
    return samples, spacing


def _first_hits(
    samples: Sequence[_Sample], footprints: Sequence[ShapelyPolygon], tree: shapely.STRtree
) -> list[tuple[int, float] | None]:
    """For each sample, (building index, distance) of the first footprint its inward ray reaches,
    or None. The lowest building index wins a tie."""
    hits: list[tuple[int, float] | None] = []
    for sample in samples:
        end = (sample.point.x + sample.normal[0] * _RAY_METERS, sample.point.y + sample.normal[1] * _RAY_METERS)
        ray = LineString([(sample.point.x, sample.point.y), end])
        best: tuple[int, float] | None = None
        for index in sorted(int(candidate) for candidate in tree.query(ray, predicate="intersects")):
            distance = sample.point.distance(ray.intersection(footprints[index]))
            if best is None or distance < best[1]:
                best = (index, distance)
        hits.append(best)
    return hits


def _segments(labels: Sequence[int | None]) -> list[tuple[int | None, int, int]]:
    """The circular sequence of `labels` as (label, first sample, count) segments, starting at the
    first sample that differs from its predecessor; the first sample is the start when all agree."""
    count = len(labels)
    first = next((index for index in range(count) if labels[index] != labels[index - 1]), 0)
    segments: list[tuple[int | None, int, int]] = []
    for offset in range(count):
        index = (first + offset) % count
        if segments and segments[-1][0] == labels[index]:
            label, start, size = segments[-1]
            segments[-1] = (label, start, size + 1)
        else:
            segments.append((labels[index], index, 1))
    return segments


def _depth(footprint: ShapelyPolygon, ring: LineString, middle: float) -> float:
    """The footprint's extent across the ring at `middle` metres along it."""
    length = ring.length
    before = ring.interpolate((middle - _TANGENT_HALF_SPAN_METERS) % length)
    after = ring.interpolate((middle + _TANGENT_HALF_SPAN_METERS) % length)
    dx, dy = after.x - before.x, after.y - before.y
    norm = math.hypot(dx, dy)
    if norm <= _MIN_EDGE_METERS:
        return 0.0
    offsets = [(-x * dy + y * dx) / norm for x, y in footprint.exterior.coords]
    return max(offsets) - min(offsets)


def measure_block(
    block: Block, buildings: Sequence[Building], projection: LocalProjection | None = None
) -> BlockMeasurement | None:
    """None when the block has no buildable area, no frontage, or none of `buildings` can be
    measured. `projection` defaults to one centred on the block.

    Frontage is cast, not projected: a ray goes 25 m inward from a sample every metre along each
    exterior ring of the buildable area (the curb line), and the first building it reaches fronts
    that sample. Coverage is covered samples over all samples. A building's runs are its stretches
    of consecutive samples (`edge_index` is the ring with most of them; `start_m`/`end_m` are its
    longest run there, `end_m` past the ring's length when it straddles the start; `width_m` is
    that run's length). Side gaps are the uncovered stretches between two different buildings. A
    building no ray reaches is interior: it is in `measures` (so it counts as a building and for
    levels) with width and depth 0, and `fingerprint_of` leaves it out of the shape statistics."""
    if block.buildable_area is None:
        return None
    projection = projection or local_projection_for(block.boundary)
    polygons = sorted(
        polygons_of(multipolygon_to_local(projection, block.buildable_area)), key=lambda polygon: polygon.bounds[:2]
    )
    rings = [(LineString(polygon.exterior.coords), polygon) for polygon in polygons]
    rings = [(ring, polygon) for ring, polygon in rings if ring.length > _MIN_EDGE_METERS]
    footprints: list[ShapelyPolygon] = []
    levels: list[int | None] = []
    for building in sorted(buildings, key=lambda building: str(building.id)):
        footprint = polygon_to_local(projection, building.geom)
        if not footprint.is_empty and footprint.area > 0:
            footprints.append(footprint)
            levels.append(building.levels)
    if not rings or not footprints:
        return None

    tree = shapely.STRtree(footprints)
    frontage_m = sum(ring.length for ring, _ in rings)
    distances: dict[int, list[float]] = {index: [] for index in range(len(footprints))}
    runs: dict[int, dict[int, list[tuple[float, float]]]] = {index: {} for index in range(len(footprints))}
    gaps: list[float] = []
    covered = 0
    total = 0
    for ring_index, (ring, polygon) in enumerate(rings):
        samples, spacing = _samples(ring, polygon)
        hits = _first_hits(samples, footprints, tree)
        total += len(samples)
        covered += sum(1 for hit in hits if hit is not None)
        for hit in hits:
            if hit is not None:
                distances[hit[0]].append(hit[1])
        segments = _segments([hit[0] if hit is not None else None for hit in hits])
        for label, start, size in segments:
            if label is not None:
                runs[label].setdefault(ring_index, []).append((start * spacing, (start + size) * spacing))
        for position, (label, _, size) in enumerate(segments):
            following = segments[(position + 1) % len(segments)][0]
            if label is None and len(segments) > 2:
                # An uncovered stretch between two different buildings is a side gap.
                if segments[position - 1][0] != following:
                    gaps.append(size * spacing)
            elif label is not None and following is not None and label != following:
                gaps.append(0.0)  # neighbours with nothing between them are attached

    measures = []
    for index, footprint in enumerate(footprints):
        if not runs[index]:
            nearest = min(range(len(rings)), key=lambda ring: (footprint.distance(rings[ring][0]), ring))
            measures.append(
                BuildingMeasure(
                    edge_index=nearest,
                    start_m=0.0,
                    end_m=0.0,
                    width_m=0.0,
                    depth_m=0.0,
                    front_setback_m=footprint.distance(rings[nearest][0]),
                    area_square_meters=footprint.area,
                    levels=levels[index],
                )
            )
            continue
        ring_index = max(runs[index], key=lambda ring: (sum(end - start for start, end in runs[index][ring]), -ring))
        ring = rings[ring_index][0]
        own = sorted(runs[index][ring_index])
        # A run that ends at the ring's end and one that begins at its start are one run.
        if len(own) > 1 and own[0][0] == 0.0 and own[-1][1] >= ring.length - 1e-9:
            first = own.pop(0)
            own[-1] = (own[-1][0], ring.length + first[1])
        start, end = max(own, key=lambda run: run[1] - run[0])
        measures.append(
            BuildingMeasure(
                edge_index=ring_index,
                start_m=start,
                end_m=end,
                width_m=end - start,
                depth_m=_depth(footprint, ring, (start + end) / 2 % ring.length),
                front_setback_m=float(statistics.median(distances[index])),
                area_square_meters=footprint.area,
                levels=levels[index],
                runs=tuple(own),
            )
        )
    return BlockMeasurement(frontage_m, tuple(measures), tuple(float(gap) for gap in gaps), coverage_ratio(covered, total))


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
