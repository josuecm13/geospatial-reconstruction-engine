import uuid
from dataclasses import dataclass

from app.domain.bounding_box import Coordinate
from app.domain.enums import RoadClassification
from app.domain.geometry import LineString


@dataclass(frozen=True)
class Street:
    id: uuid.UUID | None
    import_area_id: uuid.UUID
    source_id: str
    name: str | None
    classification: RoadClassification


@dataclass(frozen=True)
class Road:
    id: uuid.UUID | None
    import_area_id: uuid.UUID
    source_id: str
    classification: RoadClassification
    geom: LineString
    street_id: uuid.UUID | None = None


@dataclass(frozen=True)
class NavigableNode:
    id: uuid.UUID | None
    import_area_id: uuid.UUID
    source_id: str
    point: Coordinate


@dataclass(frozen=True)
class RoadSegment:
    id: uuid.UUID | None
    road_id: uuid.UUID
    from_node_id: uuid.UUID
    to_node_id: uuid.UUID
    geom: LineString
    distance_meters: float | None = None
    lane_count: int | None = None
    is_vehicle_accessible: bool = True


@dataclass(frozen=True)
class RoadSegmentWithStreet:
    """A road segment paired with its street's name/classification, as values —
    no street id: a street is one OSM way today (Milestone 7.1 groups ways into
    logical streets), so publishing a street identifier now would be a contract
    that breaks."""

    segment: RoadSegment
    street_name: str | None
    street_classification: RoadClassification
