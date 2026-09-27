"""Generated street cross-sections: lane count, lane type, and carriageway width.

OSM rarely states lanes or width, so the cross-section is generated from the
road's classification and direction, with any source-stated lane count taking
precedence. It is computed on read and never stored: changing a width below
needs no re-import, and the stored `RoadSegment.lane_count` keeps recording
only what the source stated.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from app.domain.enums import LaneCountProvenance, LaneType, RoadClassification
from app.domain.road_graph import RoadSegmentWithStreet

# Carriageway width of one lane, in meters.
LANE_WIDTH_METERS: dict[LaneType, float] = {
    LaneType.NARROW: 2.75,
    LaneType.NORMAL: 3.25,
    LaneType.WIDE: 3.65,
}

# An untagged street gets two lanes: 1 + 1 on a two-way road, both forward on a one-way road.
DEFAULT_LANES_PER_STREET = 2

_LANE_TYPE_BY_CLASSIFICATION: dict[RoadClassification, LaneType] = {
    RoadClassification.SERVICE: LaneType.NARROW,
    RoadClassification.RESIDENTIAL: LaneType.NORMAL,
    RoadClassification.UNCLASSIFIED: LaneType.NORMAL,
    RoadClassification.TERTIARY: LaneType.NORMAL,
    RoadClassification.SECONDARY: LaneType.WIDE,
    RoadClassification.PRIMARY: LaneType.WIDE,
    RoadClassification.TRUNK: LaneType.WIDE,
    RoadClassification.MOTORWAY: LaneType.WIDE,
}


@dataclass(frozen=True)
class DirectionLanes:
    count: int
    provenance: LaneCountProvenance


@dataclass(frozen=True)
class RoadCrossSection:
    """`backward` is None on a one-way road, which has no lanes against its travel direction."""

    lane_type: LaneType
    forward: DirectionLanes
    backward: DirectionLanes | None

    @property
    def lane_width_meters(self) -> float:
        return LANE_WIDTH_METERS[self.lane_type]

    @property
    def width_meters(self) -> float:
        total = self.forward.count + (self.backward.count if self.backward else 0)
        return total * self.lane_width_meters


@dataclass(frozen=True)
class SegmentCrossSection:
    """A road's cross-section seen from one directed segment: its own direction's lanes, the whole road's width."""

    lane_count: int
    lane_count_provenance: LaneCountProvenance
    lane_type: LaneType
    width_meters: float


def lane_type_for(classification: RoadClassification) -> LaneType:
    return _LANE_TYPE_BY_CLASSIFICATION[classification]


def _direction_lanes(tagged: int | None, default: int) -> DirectionLanes:
    if tagged is not None:
        return DirectionLanes(tagged, LaneCountProvenance.TAGGED)
    return DirectionLanes(default, LaneCountProvenance.DEFAULTED)


def cross_section_for_road(
    classification: RoadClassification,
    *,
    forward_lanes: int | None,
    backward_lanes: int | None,
    is_one_way: bool,
) -> RoadCrossSection:
    """`forward` is the travel direction on a one-way road; `backward_lanes` is then ignored."""
    lane_type = lane_type_for(classification)
    if is_one_way:
        return RoadCrossSection(lane_type, _direction_lanes(forward_lanes, DEFAULT_LANES_PER_STREET), None)
    per_direction = DEFAULT_LANES_PER_STREET // 2
    return RoadCrossSection(
        lane_type,
        _direction_lanes(forward_lanes, per_direction),
        _direction_lanes(backward_lanes, per_direction),
    )


def cross_sections_by_segment(entries: Iterable[RoadSegmentWithStreet]) -> dict[uuid.UUID, SegmentCrossSection]:
    """Cross-section per segment id, from an import area's directed segments.

    Ingestion emits a reverse twin (same road, endpoints swapped) for every
    piece of a two-way road and none for a one-way road, so a segment without
    a twin belongs to a one-way road.
    """
    entries = list(entries)
    by_direction = {
        (entry.segment.road_id, entry.segment.from_node_id, entry.segment.to_node_id): entry.segment
        for entry in entries
    }
    result: dict[uuid.UUID, SegmentCrossSection] = {}
    for entry in entries:
        segment = entry.segment
        twin = by_direction.get((segment.road_id, segment.to_node_id, segment.from_node_id))
        road = cross_section_for_road(
            entry.road_classification,
            forward_lanes=segment.lane_count,
            backward_lanes=twin.lane_count if twin else None,
            is_one_way=twin is None,
        )
        result[segment.id] = SegmentCrossSection(
            lane_count=road.forward.count,
            lane_count_provenance=road.forward.provenance,
            lane_type=road.lane_type,
            width_meters=road.width_meters,
        )
    return result
