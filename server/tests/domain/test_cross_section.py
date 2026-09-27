import uuid

import pytest

from app.domain.bounding_box import Coordinate
from app.domain.cross_section import (
    LANE_WIDTH_METERS,
    cross_section_for_road,
    cross_sections_by_segment,
    lane_type_for,
)
from app.domain.enums import LaneCountProvenance, LaneType, RoadClassification
from app.domain.road_graph import RoadSegment, RoadSegmentWithStreet

TAGGED = LaneCountProvenance.TAGGED
DEFAULTED = LaneCountProvenance.DEFAULTED


@pytest.mark.parametrize(
    ("classification", "expected"),
    [
        (RoadClassification.SERVICE, LaneType.NARROW),
        (RoadClassification.RESIDENTIAL, LaneType.NORMAL),
        (RoadClassification.UNCLASSIFIED, LaneType.NORMAL),
        (RoadClassification.TERTIARY, LaneType.NORMAL),
        (RoadClassification.SECONDARY, LaneType.WIDE),
        (RoadClassification.PRIMARY, LaneType.WIDE),
        (RoadClassification.TRUNK, LaneType.WIDE),
        (RoadClassification.MOTORWAY, LaneType.WIDE),
    ],
)
def test_lane_type_follows_classification(classification, expected):
    assert lane_type_for(classification) is expected


def test_every_classification_has_a_lane_type():
    for classification in RoadClassification:
        assert lane_type_for(classification) in LANE_WIDTH_METERS


@pytest.mark.parametrize(
    ("forward", "backward", "one_way", "expected_forward", "expected_backward"),
    [
        # Untagged: two lanes per street, 1 + 1 two-way, both forward one-way.
        (None, None, False, (1, DEFAULTED), (1, DEFAULTED)),
        (None, None, True, (2, DEFAULTED), None),
        # A tagged direction keeps its tag; only the silent side is defaulted.
        (2, 1, False, (2, TAGGED), (1, TAGGED)),
        (2, None, False, (2, TAGGED), (1, DEFAULTED)),
        (3, None, True, (3, TAGGED), None),
        # On a one-way road the reverse value is irrelevant.
        (None, 4, True, (2, DEFAULTED), None),
    ],
)
def test_lane_counts_prefer_tags_and_default_the_rest(forward, backward, one_way, expected_forward, expected_backward):
    section = cross_section_for_road(
        RoadClassification.RESIDENTIAL, forward_lanes=forward, backward_lanes=backward, is_one_way=one_way
    )

    assert (section.forward.count, section.forward.provenance) == expected_forward
    if expected_backward is None:
        assert section.backward is None
    else:
        assert (section.backward.count, section.backward.provenance) == expected_backward


@pytest.mark.parametrize(
    ("classification", "forward", "backward", "one_way", "expected_width"),
    [
        (RoadClassification.RESIDENTIAL, None, None, False, 2 * 3.25),
        (RoadClassification.SERVICE, None, None, True, 2 * 2.75),
        (RoadClassification.PRIMARY, 2, 2, False, 4 * 3.65),
        (RoadClassification.SECONDARY, 3, None, True, 3 * 3.65),
    ],
)
def test_width_is_total_lanes_times_lane_width(classification, forward, backward, one_way, expected_width):
    section = cross_section_for_road(classification, forward_lanes=forward, backward_lanes=backward, is_one_way=one_way)

    assert section.width_meters == pytest.approx(expected_width)


def _entry(road_id, from_node, to_node, lane_count=None, classification=RoadClassification.RESIDENTIAL):
    segment = RoadSegment(
        id=uuid.uuid4(),
        road_id=road_id,
        from_node_id=from_node,
        to_node_id=to_node,
        geom=(Coordinate(30.0, -97.8), Coordinate(30.0, -97.799)),
        lane_count=lane_count,
    )
    return RoadSegmentWithStreet(segment, "Any Street", RoadClassification.PRIMARY, classification)


def test_segments_with_a_reverse_twin_are_two_way_and_share_the_road_width():
    road, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    forward = _entry(road, a, b, lane_count=2)
    backward = _entry(road, b, a)

    sections = cross_sections_by_segment([forward, backward])

    assert (sections[forward.segment.id].lane_count, sections[forward.segment.id].lane_count_provenance) == (2, TAGGED)
    assert (sections[backward.segment.id].lane_count, sections[backward.segment.id].lane_count_provenance) == (1, DEFAULTED)
    assert sections[forward.segment.id].width_meters == pytest.approx(3 * 3.25)
    assert sections[backward.segment.id].width_meters == pytest.approx(3 * 3.25)


def test_a_segment_without_a_twin_is_one_way_and_uses_its_road_classification():
    one_way = _entry(uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), classification=RoadClassification.SERVICE)

    section = cross_sections_by_segment([one_way])[one_way.segment.id]

    assert (section.lane_count, section.lane_count_provenance) == (2, DEFAULTED)
    assert section.lane_type is LaneType.NARROW  # the road's class, not the street's PRIMARY
    assert section.width_meters == pytest.approx(2 * 2.75)


def test_a_twin_on_another_road_does_not_make_a_segment_two_way():
    a, b = uuid.uuid4(), uuid.uuid4()
    first = _entry(uuid.uuid4(), a, b)
    other_road_reverse = _entry(uuid.uuid4(), b, a)

    sections = cross_sections_by_segment([first, other_road_reverse])

    assert sections[first.segment.id].lane_count == 2
