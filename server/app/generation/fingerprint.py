"""Measuring a block's real buildings against its street frontage, so a nearly complete block can
be a reference for others (contract 4). Everything is in local metres."""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from shapely.geometry import LineString
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
    side_gaps,
    union_length,
)
from app.domain.local_projection import LocalProjection, local_projection_for
from app.generation.geometry import multipolygon_to_local, polygon_to_local, polygons_of

_MIN_EDGE_METERS = 1e-6


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


def measure_building(footprint: ShapelyPolygon, edges: Sequence[Edge], levels: int | None = None) -> BuildingMeasure:
    """`footprint` against its nearest edge (the lowest index on a tie): the distance to the edge, and
    the footprint's extent along and across it."""
    edge_index = min(range(len(edges)), key=lambda index: (footprint.distance(edges[index].line), index))
    edge = edges[edge_index]
    length = edge.length
    along = ((edge.end[0] - edge.start[0]) / length, (edge.end[1] - edge.start[1]) / length)
    across = (-along[1], along[0])
    vertices = list(footprint.exterior.coords)
    positions = [(x - edge.start[0]) * along[0] + (y - edge.start[1]) * along[1] for x, y in vertices]
    offsets = [(x - edge.start[0]) * across[0] + (y - edge.start[1]) * across[1] for x, y in vertices]
    return BuildingMeasure(
        edge_index=edge_index,
        start_m=min(positions),
        end_m=max(positions),
        width_m=max(positions) - min(positions),
        depth_m=max(offsets) - min(offsets),
        front_setback_m=footprint.distance(edge.line),
        area_square_meters=footprint.area,
        levels=levels,
    )


def measure_block(
    block: Block, buildings: Sequence[Building], projection: LocalProjection | None = None
) -> BlockMeasurement | None:
    """None when the block has no buildable area, no frontage, or none of `buildings` can be
    measured. `projection` defaults to one centred on the block."""
    if block.buildable_area is None:
        return None
    projection = projection or local_projection_for(block.boundary)
    edges = frontage_edges(polygons_of(multipolygon_to_local(projection, block.buildable_area)))
    frontage_m = frontage_length(edges)
    footprints = [
        (polygon_to_local(projection, building.geom), building.levels)
        for building in sorted(buildings, key=lambda building: str(building.id))
    ]
    measures = tuple(
        measure_building(footprint, edges, levels)
        for footprint, levels in footprints
        if not footprint.is_empty and footprint.area > 0
    )
    if not edges or not measures:
        return None

    gaps: list[float] = []
    covered_m = 0.0
    for index, edge in enumerate(edges):
        intervals = [(measure.start_m, measure.end_m) for measure in measures if measure.edge_index == index]
        gaps.extend(side_gaps(intervals))
        # Coverage counts only the part of a building that lies along this edge.
        covered_m += union_length(
            (max(start, 0.0), min(end, edge.length)) for start, end in intervals if end > 0 and start < edge.length
        )
    return BlockMeasurement(frontage_m, measures, tuple(gaps), coverage_ratio(covered_m, frontage_m))


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
