from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import RoadClassification
from app.domain.geometry import linestring_length_meters
from app.domain.road_graph import NavigableNode, Road, RoadSegment, Street
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.road_graph import (
    NavigableNodeRepository,
    RoadRepository,
    RoadSegmentRepository,
    StreetRepository,
)


def _import_area_id(db_session):
    bbox = BoundingBox(
        min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.005, -97.795)
    )
    return ImportAreaRepository(db_session).get_or_create("osm", bbox).id


def test_upsert_road_by_source_id_is_idempotent(db_session):
    import_area_id = _import_area_id(db_session)
    repo = RoadRepository(db_session)
    road = Road(
        id=None,
        import_area_id=import_area_id,
        source_id="way/1",
        classification=RoadClassification.RESIDENTIAL,
        geom=(Coordinate(30.0, -97.8), Coordinate(30.001, -97.8)),
    )

    first = repo.upsert(road)
    second = repo.upsert(road)

    assert first.id == second.id


def test_same_source_id_in_different_import_areas_creates_two_roads(db_session):
    bbox = BoundingBox(
        min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.005, -97.795)
    )
    other_bbox = BoundingBox(
        min_corner=Coordinate(31.0, -98.8), max_corner=Coordinate(31.005, -98.795)
    )
    import_area_repo = ImportAreaRepository(db_session)
    area_a = import_area_repo.get_or_create("osm", bbox).id
    area_b = import_area_repo.get_or_create("osm", other_bbox).id

    repo = RoadRepository(db_session)
    road_a = repo.upsert(
        Road(
            id=None,
            import_area_id=area_a,
            source_id="way/1",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, -97.8), Coordinate(30.001, -97.8)),
        )
    )
    road_b = repo.upsert(
        Road(
            id=None,
            import_area_id=area_b,
            source_id="way/1",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(31.0, -98.8), Coordinate(31.001, -98.8)),
        )
    )

    assert road_a.id != road_b.id


def test_two_way_road_produces_two_opposite_segments(db_session):
    import_area_id = _import_area_id(db_session)
    road = RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id="way/2",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, -97.8), Coordinate(30.001, -97.8)),
        )
    )
    node_repo = NavigableNodeRepository(db_session)
    node_a = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/1", point=Coordinate(30.0, -97.8))
    )
    node_b = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/2", point=Coordinate(30.001, -97.8))
    )

    segment_repo = RoadSegmentRepository(db_session)
    forward = segment_repo.upsert(
        RoadSegment(
            id=None,
            road_id=road.id,
            from_node_id=node_a.id,
            to_node_id=node_b.id,
            geom=(node_a.point, node_b.point),
            lane_count=1,
        )
    )
    backward = segment_repo.upsert(
        RoadSegment(
            id=None,
            road_id=road.id,
            from_node_id=node_b.id,
            to_node_id=node_a.id,
            geom=(node_b.point, node_a.point),
            lane_count=1,
        )
    )

    assert forward.id != backward.id
    assert forward.from_node_id == backward.to_node_id
    assert forward.to_node_id == backward.from_node_id


def test_segment_lane_count_is_nullable_for_unknown(db_session):
    import_area_id = _import_area_id(db_session)
    road = RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id="way/3",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, -97.8), Coordinate(30.001, -97.8)),
        )
    )
    node_repo = NavigableNodeRepository(db_session)
    node_a = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/3", point=Coordinate(30.0, -97.8))
    )
    node_b = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/4", point=Coordinate(30.001, -97.8))
    )

    segment = RoadSegmentRepository(db_session).upsert(
        RoadSegment(
            id=None,
            road_id=road.id,
            from_node_id=node_a.id,
            to_node_id=node_b.id,
            geom=(node_a.point, node_b.point),
            lane_count=None,
        )
    )

    assert segment.lane_count is None


def test_segment_distance_meters_matches_geodesic_length(db_session):
    import_area_id = _import_area_id(db_session)
    road = RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id="way/4",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, -97.8), Coordinate(30.001, -97.8)),
        )
    )
    node_repo = NavigableNodeRepository(db_session)
    node_a = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/5", point=Coordinate(30.0, -97.8))
    )
    node_b = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/6", point=Coordinate(30.001, -97.8))
    )
    geom = (node_a.point, node_b.point)

    segment = RoadSegmentRepository(db_session).upsert(
        RoadSegment(
            id=None,
            road_id=road.id,
            from_node_id=node_a.id,
            to_node_id=node_b.id,
            geom=geom,
        )
    )

    expected = linestring_length_meters(geom)
    assert segment.distance_meters == expected


def test_street_upsert_is_idempotent(db_session):
    import_area_id = _import_area_id(db_session)
    repo = StreetRepository(db_session)
    street = Street(
        id=None,
        import_area_id=import_area_id,
        source_id="street/1",
        name="Main St",
        classification=RoadClassification.RESIDENTIAL,
    )

    first = repo.upsert(street)
    second = repo.upsert(street)

    assert first.id == second.id
    assert first.name == "Main St"


def _node(import_area_id, source_id, lat, lon):
    return NavigableNode(id=None, import_area_id=import_area_id, source_id=source_id, point=Coordinate(lat, lon))


def test_node_and_road_upsert_many_create_then_update_in_place(db_session):
    area = _import_area_id(db_session)
    nodes = NavigableNodeRepository(db_session)
    roads = RoadRepository(db_session)
    batch = [_node(area, "node/a", 30.0, -97.8), _node(area, "node/b", 30.001, -97.8)]
    road_batch = [
        Road(None, area, f"way/{i}", RoadClassification.RESIDENTIAL, (Coordinate(30.0, -97.8), Coordinate(30.001, -97.8)))
        for i in range(2)
    ]

    first_nodes, first_roads = nodes.upsert_many(area, batch), roads.upsert_many(area, road_batch)
    moved = [_node(area, "node/a", 30.002, -97.8), _node(area, "node/b", 30.001, -97.8)]
    second_nodes, second_roads = nodes.upsert_many(area, moved), roads.upsert_many(area, road_batch)

    assert set(first_nodes) == {"node/a", "node/b"} and set(first_roads) == {"way/0", "way/1"}
    assert {k: v.id for k, v in first_nodes.items()} == {k: v.id for k, v in second_nodes.items()}
    assert {k: v.id for k, v in first_roads.items()} == {k: v.id for k, v in second_roads.items()}
    assert second_nodes["node/a"].point == Coordinate(30.002, -97.8)
    assert len(nodes.list_for_import_area(area)) == 2


def test_upsert_many_with_the_same_key_twice_leaves_one_row(db_session):
    area = _import_area_id(db_session)
    nodes = NavigableNodeRepository(db_session)

    result = nodes.upsert_many(area, [_node(area, "node/a", 30.0, -97.8), _node(area, "node/a", 30.003, -97.8)])

    assert list(result) == ["node/a"]
    assert result["node/a"].point == Coordinate(30.003, -97.8)
    assert len(nodes.list_for_import_area(area)) == 1


def test_street_upsert_many_keeps_the_supplied_ids_and_updates_in_place(db_session):
    area = _import_area_id(db_session)
    repo = StreetRepository(db_session)
    street = Street(None, area, "street/1", "Main St", RoadClassification.RESIDENTIAL)

    first = repo.upsert_many(area, [street])
    renamed = Street(None, area, "street/1", "High St", RoadClassification.RESIDENTIAL)
    second = repo.upsert_many(area, [renamed])

    assert first["street/1"].id == second["street/1"].id
    assert second["street/1"].name == "High St"


def test_segment_upsert_many_returns_one_per_input_and_updates_in_place(db_session):
    area = _import_area_id(db_session)
    road = RoadRepository(db_session).upsert(
        Road(None, area, "way/1", RoadClassification.RESIDENTIAL, (Coordinate(30.0, -97.8), Coordinate(30.001, -97.8)))
    )
    nodes = NavigableNodeRepository(db_session).upsert_many(
        area, [_node(area, "node/a", 30.0, -97.8), _node(area, "node/b", 30.001, -97.8)]
    )
    a, b = nodes["node/a"], nodes["node/b"]
    forward = RoadSegment(None, road.id, a.id, b.id, (a.point, b.point), lane_count=2)
    backward = RoadSegment(None, road.id, b.id, a.id, (b.point, a.point), lane_count=1)
    repo = RoadSegmentRepository(db_session)

    first = repo.upsert_many([forward, backward])
    second = repo.upsert_many([forward, backward])

    assert [s.id for s in first] == [s.id for s in second]
    assert first[0].id != first[1].id
    assert [s.lane_count for s in second] == [2, 1]
    assert len(repo.list_for_import_area(area)) == 2


def test_segment_upsert_many_with_the_same_key_twice_leaves_one_row(db_session):
    area = _import_area_id(db_session)
    road = RoadRepository(db_session).upsert(
        Road(None, area, "way/1", RoadClassification.RESIDENTIAL, (Coordinate(30.0, -97.8), Coordinate(30.001, -97.8)))
    )
    nodes = NavigableNodeRepository(db_session).upsert_many(
        area, [_node(area, "node/a", 30.0, -97.8), _node(area, "node/b", 30.001, -97.8)]
    )
    a, b = nodes["node/a"], nodes["node/b"]
    repo = RoadSegmentRepository(db_session)

    result = repo.upsert_many([
        RoadSegment(None, road.id, a.id, b.id, (a.point, b.point), lane_count=1),
        RoadSegment(None, road.id, a.id, b.id, (a.point, b.point), lane_count=3),
    ])

    assert result[0].id == result[1].id
    assert [s.lane_count for s in repo.list_for_import_area(area)] == [3]
