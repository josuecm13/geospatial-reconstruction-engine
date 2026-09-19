from types import SimpleNamespace

from app.domain.bounding_box import Coordinate
from app.domain.enums import RoadClassification
from app.domain.road_graph import Road
from app.ingestion.osm_adapter import ImportRoad
from app.ingestion.service import OSMIngestionService


def test_reverse_one_way_creates_only_a_reverse_directed_segment_with_backward_lanes():
    source_road = ImportRoad(
        source_id="way-1",
        node_ids=("a", "b"),
        classification=RoadClassification.RESIDENTIAL,
        name=None,
        one_way_direction=-1,
        forward_lanes=2,
        backward_lanes=1,
    )
    coordinates = {
        "a": Coordinate(9.934, -84.080),
        "b": Coordinate(9.934, -84.079),
    }
    nodes = {"a": SimpleNamespace(id="node-a"), "b": SimpleNamespace(id="node-b")}
    road = Road(None, "area", "way-1", RoadClassification.RESIDENTIAL, tuple(coordinates.values()))

    segments = OSMIngestionService._segments_for_road(source_road, road, nodes, coordinates, {"a", "b"})

    assert len(segments) == 1
    assert segments[0].from_node_id == "node-b"
    assert segments[0].to_node_id == "node-a"
    assert segments[0].lane_count == 1
