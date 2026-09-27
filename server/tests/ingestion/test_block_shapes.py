"""Milestone 7.2: blocks' buildable area, median and clipped flags, through a full import."""

import json
from pathlib import Path

import pytest

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.cross_section import LANE_WIDTH_METERS, DEFAULT_LANES_PER_STREET
from app.domain.enums import LaneType
from app.domain.geometry import linestring_length_meters
from app.ingestion.service import OSMIngestionService
from app.persistence.repositories.block import BlockRepository

LOOP_FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_block_loop.json"
LOOP_BBOX = BoundingBox(Coordinate(9.9398, -84.0902), Coordinate(9.9407, -84.0893))

# A residential two-way street defaults to 1 + 1 normal lanes.
RESIDENTIAL_HALF_WIDTH = DEFAULT_LANES_PER_STREET * LANE_WIDTH_METERS[LaneType.NORMAL] / 2


def _blocks(db_session, result):
    return BlockRepository(db_session).list_for_import_area(result.import_area.id)


def test_buildable_area_is_the_block_minus_its_bounding_roads_half_widths(db_session):
    result = OSMIngestionService(db_session).import_fixture(LOOP_BBOX, json.loads(LOOP_FIXTURE.read_text()))

    [block] = _blocks(db_session, result)
    # The loop is a rectangle of four residential streets, so the buildable area is
    # the rectangle shrunk by one half-width on every side.
    south, east = (Coordinate(9.94, -84.09), Coordinate(9.94, -84.0895)), (Coordinate(9.94, -84.0895), Coordinate(9.9405, -84.0895))
    width, height = linestring_length_meters(south), linestring_length_meters(east)
    expected = (width - 2 * RESIDENTIAL_HALF_WIDTH) * (height - 2 * RESIDENTIAL_HALF_WIDTH)

    assert block.buildable_area is not None
    assert block.buildable_area_square_meters < block.area_square_meters
    assert block.buildable_area_square_meters == pytest.approx(expected, rel=0.005)
    assert not block.is_median
    assert not block.is_clipped


# A divided road: two one-way carriageways 9 m apart, joined at both ends, above a
# plain block. Each carriageway is 2 normal lanes (6.5 m) wide, so the 9 m strip
# between them keeps only 2.5 m, too narrow to build on.
_SOUTH, _MID_A, _MID_B = 9.9500, 9.9505, 9.9505 + 9 / 111_320
_WEST, _EAST = -84.0900, -84.0895
DIVIDED_BBOX = BoundingBox(Coordinate(9.9498, -84.0902), Coordinate(9.9508, -84.0893))


def _divided_road_payload() -> dict:
    nodes = {1: (_SOUTH, _WEST), 2: (_SOUTH, _EAST), 3: (_MID_A, _EAST), 4: (_MID_A, _WEST), 5: (_MID_B, _EAST), 6: (_MID_B, _WEST)}
    residential = {"highway": "residential"}
    carriageway = {"highway": "residential", "name": "Divided Avenue", "oneway": "yes"}
    ways = [
        (10, [1, 2], residential),
        (11, [2, 3], residential),
        (12, [4, 1], residential),
        (20, [4, 3], carriageway),
        (21, [5, 6], carriageway),
        (22, [3, 5], residential),
        (23, [6, 4], residential),
    ]
    return {
        "elements": [{"type": "node", "id": n, "lat": lat, "lon": lon} for n, (lat, lon) in nodes.items()]
        + [{"type": "way", "id": w, "nodes": refs, "tags": tags} for w, refs, tags in ways]
    }


def test_a_divided_roads_median_is_flagged_and_a_real_block_is_not(db_session):
    result = OSMIngestionService(db_session).import_fixture(DIVIDED_BBOX, _divided_road_payload())

    blocks = sorted(_blocks(db_session, result), key=lambda block: block.area_square_meters)

    assert len(blocks) == 2
    median, block = blocks
    assert median.is_median
    assert 0 < median.buildable_area_square_meters < median.area_square_meters
    assert not block.is_median
    assert block.buildable_area_square_meters > 0


# A "#" of two east-west and two north-south streets, each running past the bounding box on
# both sides: one block closed by roads alone in the middle, and eight along the box's edge.
_GRID_LATS, _GRID_LONS = (9.9601, 9.9604), (-84.0899, -84.0896)
GRID_BBOX = BoundingBox(Coordinate(9.9600, -84.0900), Coordinate(9.9605, -84.0895))
_OUTSIDE_SOUTH, _OUTSIDE_NORTH, _OUTSIDE_WEST, _OUTSIDE_EAST = 9.9598, 9.9607, -84.0902, -84.0893


def _grid_payload() -> dict:
    nodes: dict[int, tuple[float, float]] = {}
    ways = []
    crossings = {(i, j): 100 + 10 * i + j for i in range(2) for j in range(2)}
    for (i, j), node_id in crossings.items():
        nodes[node_id] = (_GRID_LATS[i], _GRID_LONS[j])
    for i, lat in enumerate(_GRID_LATS):
        west, east = 200 + i, 210 + i
        nodes[west], nodes[east] = (lat, _OUTSIDE_WEST), (lat, _OUTSIDE_EAST)
        ways.append((300 + i, [west, crossings[(i, 0)], crossings[(i, 1)], east]))
    for j, lon in enumerate(_GRID_LONS):
        south, north = 220 + j, 230 + j
        nodes[south], nodes[north] = (_OUTSIDE_SOUTH, lon), (_OUTSIDE_NORTH, lon)
        ways.append((310 + j, [south, crossings[(0, j)], crossings[(1, j)], north]))
    return {
        "elements": [{"type": "node", "id": n, "lat": lat, "lon": lon} for n, (lat, lon) in nodes.items()]
        + [{"type": "way", "id": w, "nodes": refs, "tags": {"highway": "residential"}} for w, refs in ways]
    }


def test_roads_crossing_the_bounding_box_close_flagged_edge_blocks(db_session):
    result = OSMIngestionService(db_session).import_fixture(GRID_BBOX, _grid_payload())

    blocks = _blocks(db_session, result)

    assert len(blocks) == 9
    clipped = [block for block in blocks if block.is_clipped]
    assert len(clipped) == 8
    [middle] = [block for block in blocks if not block.is_clipped]
    # The middle block is the grid's own square; every block lies inside the box.
    assert len(middle.bounding_segment_ids) == 8
    for block in blocks:
        for point in block.boundary:
            assert GRID_BBOX.min_corner.latitude - 1e-9 <= point.latitude <= GRID_BBOX.max_corner.latitude + 1e-9
            assert GRID_BBOX.min_corner.longitude - 1e-9 <= point.longitude <= GRID_BBOX.max_corner.longitude + 1e-9
    # A corner block is bounded by the two roads that leave the box there.
    corner_segment_counts = sorted(len(block.bounding_segment_ids) for block in clipped)
    assert corner_segment_counts == [4, 4, 4, 4, 6, 6, 6, 6]
    for block in clipped:
        assert 0 < block.buildable_area_square_meters < block.area_square_meters
