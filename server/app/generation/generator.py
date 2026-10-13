"""Placing buildings along a block's street frontage (contract 6).

For one block: the front setback is carved out of where buildings may go, then each frontage edge is
walked from its start, laying lots whose width, gap and depth are sampled around the block's
fingerprint. A lot becomes a building only if it fits the suitable ground, avoids the real buildings,
and does not overlap one already placed. Everything is in local metres, and nothing here reads the
database. The caller supplies the random generator, so a run is a function of its seed."""

import random
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from shapely import affinity
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.strtree import STRtree

from app.domain.block import Block
from app.domain.elevation import ElevationGrid, building_base_height
from app.domain.generation import (
    INFORMAL_OFFSET_METERS,
    INFORMAL_ROTATION_DEGREES,
    LEVEL_HEIGHT_METERS,
    TWO_STOREY_SHARE_DEFAULT,
    MIN_FOOTPRINT_SQUARE_METERS,
    BlockFeedback,
    CountSource,
    Fingerprint,
    SettlementStyle,
    draw_storeys,
    evenly_spaced_indices,
    levels_of,
    sample_dimension,
)
from app.domain.geometry import Polygon
from app.domain.local_projection import LocalProjection
from app.generation.fingerprint import Edge, frontage_edges
from app.generation.geometry import polygon_from_local, polygons_of
from app.generation.suitability import Suitability

# The front face sits this far past the setback, so a footprint never lands exactly on the edge of
# the setback strip and is not thrown out by rounding.
_FRONT_CLEARANCE_METERS = 0.001
_MAX_LOTS_PER_EDGE = 10_000


@dataclass(frozen=True)
class GeneratedFootprint:
    """A building the generator accepted. `polygon` is in local metres and `geom` is the same ring
    in WGS84, ready to store."""

    polygon: ShapelyPolygon
    geom: Polygon
    levels: int
    height_meters: float
    base_elevation_meters: float | None
    style: SettlementStyle
    reference_block_id: uuid.UUID | None
    count_source: CountSource


@dataclass(frozen=True)
class BlockGeneration:
    """What generating one block produced. `suitability` is the one used, with the setback zone
    added. `lot_count` is how many lots fitted before any feedback trimmed them, and `shortfall` how
    many buildings the feedback asked for beyond that (0 without feedback)."""

    footprints: tuple[GeneratedFootprint, ...]
    lot_count: int
    shortfall: int
    suitability: Suitability


def generate_block(
    block: Block,
    *,
    suitability: Suitability,
    fingerprint: Fingerprint,
    reference_block_id: uuid.UUID | None,
    count_source: CountSource,
    feedback: BlockFeedback | None,
    rng: random.Random,
    grid: ElevationGrid | None,
    real_footprints: Sequence[ShapelyPolygon],
    projection: LocalProjection,
    two_storey_share: float = TWO_STOREY_SHARE_DEFAULT,
) -> BlockGeneration:
    """Buildings for one block. `fingerprint` is whatever the block was matched to (calibrated, if it
    was), `real_footprints` the real buildings in and around it. With `feedback`, the lots found are
    trimmed to its count (an evenly spaced subset, in walk order), or dropped for `no_buildings`, and
    the buildings are marked `feedback`."""
    polygons = polygons_of(suitability.buildable)
    oriented = [orient(polygon, 1.0) for polygon in polygons]  # counter-clockwise: the inside is on the left
    edges = frontage_edges(oriented)

    setback = fingerprint.front_setback.median
    suitability = suitability.with_setback(_front_strip(edges, oriented, setback))
    suitable = suitability.suitable

    real_index = STRtree(list(real_footprints)) if real_footprints else None
    accepted: list[ShapelyPolygon] = []
    informal = suitability.style is SettlementStyle.INFORMAL

    for edge in edges:
        for footprint in _lots(edge, fingerprint, setback, informal, rng):
            if footprint.area < MIN_FOOTPRINT_SQUARE_METERS or not suitable.covers(footprint):
                continue
            if real_index is not None and len(real_index.query(footprint, predicate="intersects")) > 0:
                continue
            if any(footprint.intersects(other) for other in accepted):
                continue
            accepted.append(footprint)

    chosen, shortfall = accepted, 0
    source = count_source
    if feedback is not None:
        source = CountSource.FEEDBACK
        target = feedback.target_count
        chosen = [accepted[index] for index in evenly_spaced_indices(len(accepted), target)]
        shortfall = max(0, target - len(accepted))

    levels = levels_of(fingerprint)
    # Defaulted low-rise blocks get 1 or 2 storeys per building, drawn from a stable seed (not `rng`).
    mixed = not fingerprint.levels_observed and levels <= 2
    footprints = []
    for polygon in chosen:
        if mixed:
            levels = draw_storeys(_storey_seed(block, polygon), two_storey_share)
        geom = polygon_from_local(projection, polygon)
        footprints.append(
            GeneratedFootprint(
                polygon=polygon,
                geom=geom,
                levels=levels,
                height_meters=levels * LEVEL_HEIGHT_METERS,
                base_elevation_meters=building_base_height(grid, geom) if grid is not None else None,
                style=suitability.style,
                reference_block_id=reference_block_id,
                count_source=source,
            )
        )
    return BlockGeneration(tuple(footprints), len(accepted), shortfall, suitability)


def _storey_seed(block: Block, polygon: ShapelyPolygon) -> str:
    """A stable seed for a footprint: the block id and its centroid to 0.1 m, in local coordinates."""
    centre = polygon.centroid
    return f"{block.id}:{centre.x:.1f}:{centre.y:.1f}"


def _inward(edge: Edge) -> tuple[tuple[float, float], tuple[float, float]]:
    """The edge's unit direction, and the unit normal pointing into a counter-clockwise polygon."""
    length = edge.length
    along = ((edge.end[0] - edge.start[0]) / length, (edge.end[1] - edge.start[1]) / length)
    return along, (-along[1], along[0])


def _front_strip(edges: Sequence[Edge], buildable: Sequence[ShapelyPolygon], setback: float):
    """The band of the buildable area within `setback` of its frontage: the setback zone. Empty for
    a setback of 0."""
    if setback <= 0:
        return ShapelyPolygon()
    bands = []
    for polygon in buildable:
        inner = polygon.buffer(-setback, join_style="mitre")
        bands.append(polygon.difference(inner) if not inner.is_empty else polygon)
    return unary_union(bands)


def _lots(edge: Edge, fingerprint: Fingerprint, setback: float, informal: bool, rng: random.Random):
    """The candidate footprints along one edge, from its start (past the corner's setback). Every lot draws its width, depth and
    gap (and, for informal blocks, its jitter) whether or not it is later accepted."""
    along, inward = _inward(edge)
    length = edge.length
    # Start past the corner's setback: the adjacent edge's strip would reject a lot that began at 0.
    position = setback
    for _ in range(_MAX_LOTS_PER_EDGE):
        width = sample_dimension(rng, fingerprint.width)
        depth = sample_dimension(rng, fingerprint.depth)
        gap = sample_dimension(rng, fingerprint.side_gap)
        jitter = None
        if informal:
            jitter = (
                rng.uniform(-INFORMAL_ROTATION_DEGREES, INFORMAL_ROTATION_DEGREES),
                rng.uniform(-INFORMAL_OFFSET_METERS, INFORMAL_OFFSET_METERS),
                rng.uniform(0.0, INFORMAL_OFFSET_METERS),
            )
        if position + width > length + 1e-9:
            return
        yield _rectangle(edge, along, inward, position, width, setback + _FRONT_CLEARANCE_METERS, depth, jitter)
        position += width + gap


def _rectangle(
    edge: Edge,
    along: tuple[float, float],
    inward: tuple[float, float],
    position: float,
    width: float,
    front: float,
    depth: float,
    jitter: tuple[float, float, float] | None,
) -> ShapelyPolygon:
    """`width` along the edge from `position`, and `depth` inward starting `front` from it. Informal
    jitter turns it about its centre and slides it along the edge and inward."""
    sx, sy = edge.start

    def point(along_m: float, inward_m: float) -> tuple[float, float]:
        return (
            sx + along[0] * along_m + inward[0] * inward_m,
            sy + along[1] * along_m + inward[1] * inward_m,
        )

    rectangle = ShapelyPolygon(
        [point(position, front), point(position + width, front), point(position + width, front + depth), point(position, front + depth)]
    )
    if jitter is not None:
        degrees, slide_along, slide_inward = jitter
        rectangle = affinity.rotate(rectangle, degrees, origin="centroid")
        rectangle = affinity.translate(
            rectangle,
            along[0] * slide_along + inward[0] * slide_inward,
            along[1] * slide_along + inward[1] * slide_inward,
        )
    return rectangle
