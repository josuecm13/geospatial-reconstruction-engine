"""Milestone 7.2: blocks' buildable area and median flag, through a full import."""

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
