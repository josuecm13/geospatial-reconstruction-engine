from dataclasses import replace

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import RestrictionKind, RoadClassification
from app.domain.road_graph import NavigableNode, Road, RoadSegment
from app.persistence.graph_loader import load_road_graph
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.road_graph import NavigableNodeRepository, RoadRepository, RoadSegmentRepository
from app.persistence.repositories.turn_movement import TurnMovementRepository


def _import_area_id(db_session, min_corner=Coordinate(29.999, -97.801), max_corner=Coordinate(30.001, -97.799)):
    bbox = BoundingBox(min_corner=min_corner, max_corner=max_corner)
    return ImportAreaRepository(db_session).get_or_create("osm", bbox).id


def _road(db_session, import_area_id, source_id="way/graph"):
    return RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id=source_id,
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, -97.801), Coordinate(30.0, -97.799)),
        )
    )


def _node(db_session, import_area_id, source_id, point):
    return NavigableNodeRepository(db_session).upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id=source_id, point=point)
    )


def _segment(db_session, road_id, from_node, to_node, **kwargs):
    return RoadSegmentRepository(db_session).upsert(
        RoadSegment(
            id=None,
            road_id=road_id,
            from_node_id=from_node.id,
            to_node_id=to_node.id,
            geom=(from_node.point, to_node.point),
            **kwargs,
        )
    )


def _build_four_way_intersection(db_session, import_area_id):
    """center N, incoming from west (A) and south (E), outgoing east (B) and north (D)."""
    road = _road(db_session, import_area_id)
    n = _node(db_session, import_area_id, "node/N", Coordinate(30.0, -97.8))
    a = _node(db_session, import_area_id, "node/A", Coordinate(30.0, -97.801))
    b = _node(db_session, import_area_id, "node/B", Coordinate(30.0, -97.799))
    d = _node(db_session, import_area_id, "node/D", Coordinate(30.001, -97.8))
    e = _node(db_session, import_area_id, "node/E", Coordinate(29.999, -97.8))

    a_to_n = _segment(db_session, road.id, a, n)
    e_to_n = _segment(db_session, road.id, e, n)
    n_to_b = _segment(db_session, road.id, n, b)
    n_to_d = _segment(db_session, road.id, n, d)

    turn_repo = TurnMovementRepository(db_session)
    turn_repo.persist_candidates(turn_repo.generate_candidates(n.id))

    return {
        "n": n, "a": a, "b": b, "d": d, "e": e,
        "a_to_n": a_to_n, "e_to_n": e_to_n, "n_to_b": n_to_b, "n_to_d": n_to_d,
    }


def _restrict(db_session, node_id, target, *, allowed, kind=RestrictionKind.NONE):
    turn_repo = TurnMovementRepository(db_session)
    candidates = turn_repo.generate_candidates(node_id)
    adjusted = [
        replace(c, allowed=allowed, restriction_kind=kind)
        if (c.incoming_segment_id, c.outgoing_segment_id) == target
        else c
        for c in candidates
    ]
    turn_repo.persist_candidates(adjusted)


def test_one_way_segment_produces_exactly_one_edge(db_session):
    import_area_id = _import_area_id(db_session)
    road = _road(db_session, import_area_id)
    a = _node(db_session, import_area_id, "node/a", Coordinate(30.0, -97.801))
    b = _node(db_session, import_area_id, "node/b", Coordinate(30.0, -97.799))
    forward = _segment(db_session, road.id, a, b)

    graph = load_road_graph(db_session, import_area_id)

    assert {edge.id for edge in graph.edges_departing(a.id)} == {forward.id}
    assert graph.edges_departing(b.id) == ()


def test_edge_cost_matches_persisted_distance(db_session):
    import_area_id = _import_area_id(db_session)
    road = _road(db_session, import_area_id)
    a = _node(db_session, import_area_id, "node/a", Coordinate(30.0, -97.801))
    b = _node(db_session, import_area_id, "node/b", Coordinate(30.0, -97.799))
    segment = _segment(db_session, road.id, a, b)

    graph = load_road_graph(db_session, import_area_id)

    assert graph.edge(segment.id).distance_meters == segment.distance_meters
    assert graph.edge(segment.id).distance_meters >= 0


def test_prohibited_turn_is_not_offered(db_session):
    import_area_id = _import_area_id(db_session)
    fixture = _build_four_way_intersection(db_session, import_area_id)
    target = (fixture["a_to_n"].id, fixture["n_to_d"].id)
    _restrict(db_session, fixture["n"].id, target, allowed=False, kind=RestrictionKind.NO_LEFT_TURN)

    graph = load_road_graph(db_session, import_area_id)
    continuations = {edge.id for edge in graph.legal_continuations(fixture["a_to_n"].id)}

    assert fixture["n_to_d"].id not in continuations
    assert fixture["n_to_b"].id in continuations


def test_only_turn_restriction_leaves_a_single_option(db_session):
    import_area_id = _import_area_id(db_session)
    fixture = _build_four_way_intersection(db_session, import_area_id)
    turn_repo = TurnMovementRepository(db_session)
    candidates = turn_repo.generate_candidates(fixture["n"].id)
    incoming = fixture["a_to_n"].id
    only_target = fixture["n_to_d"].id
    adjusted = [
        replace(
            c,
            allowed=(c.outgoing_segment_id == only_target),
            restriction_kind=RestrictionKind.ONLY_LEFT_TURN,
        )
        if c.incoming_segment_id == incoming
        else c
        for c in candidates
    ]
    turn_repo.persist_candidates(adjusted)

    graph = load_road_graph(db_session, import_area_id)
    continuations = {edge.id for edge in graph.legal_continuations(incoming)}

    assert continuations == {only_target}


def test_unrestricted_intersection_offers_every_allowed_continuation(db_session):
    import_area_id = _import_area_id(db_session)
    fixture = _build_four_way_intersection(db_session, import_area_id)

    graph = load_road_graph(db_session, import_area_id)
    continuations = {edge.id for edge in graph.legal_continuations(fixture["a_to_n"].id)}

    assert continuations == {fixture["n_to_b"].id, fixture["n_to_d"].id}


def test_departing_from_a_node_ignores_incoming_restrictions(db_session):
    import_area_id = _import_area_id(db_session)
    fixture = _build_four_way_intersection(db_session, import_area_id)
    target = (fixture["a_to_n"].id, fixture["n_to_d"].id)
    _restrict(db_session, fixture["n"].id, target, allowed=False, kind=RestrictionKind.NO_LEFT_TURN)

    graph = load_road_graph(db_session, import_area_id)
    departing = {edge.id for edge in graph.edges_departing(fixture["n"].id)}

    # n_to_d is prohibited as a turn from a_to_n, but departing from N directly
    # makes no turn at all, so it is still offered.
    assert fixture["n_to_d"].id in departing
    assert fixture["n_to_b"].id in departing


def test_vehicle_inaccessible_segment_is_excluded(db_session):
    import_area_id = _import_area_id(db_session)
    road = _road(db_session, import_area_id)
    a = _node(db_session, import_area_id, "node/a", Coordinate(30.0, -97.801))
    b = _node(db_session, import_area_id, "node/b", Coordinate(30.0, -97.799))
    segment = _segment(db_session, road.id, a, b, is_vehicle_accessible=False)

    graph = load_road_graph(db_session, import_area_id)

    assert segment.id not in graph.edges_by_id
    assert graph.edges_departing(a.id) == ()


def _reachable_nodes(graph, origin):
    visited = {origin}
    frontier = list(graph.edges_departing(origin))
    while frontier:
        edge = frontier.pop()
        if edge.to_node_id in visited:
            continue
        visited.add(edge.to_node_id)
        frontier.extend(graph.legal_continuations(edge.id))
    return visited


def test_connected_intersections_are_reachable(db_session):
    import_area_id = _import_area_id(db_session)
    road = _road(db_session, import_area_id)
    a = _node(db_session, import_area_id, "node/a", Coordinate(30.0, -97.801))
    b = _node(db_session, import_area_id, "node/b", Coordinate(30.0, -97.8))
    c = _node(db_session, import_area_id, "node/c", Coordinate(30.0, -97.799))
    _segment(db_session, road.id, a, b)
    _segment(db_session, road.id, b, c)
    # Turn movements are generated during ingestion, not on segment insert;
    # without persisting node b's candidates, traversal could only ever take
    # the first hop and would dead-end after it regardless of connectivity.
    turn_repo = TurnMovementRepository(db_session)
    turn_repo.persist_candidates(turn_repo.generate_candidates(b.id))

    graph = load_road_graph(db_session, import_area_id)

    assert c.id in _reachable_nodes(graph, a.id)


def test_disconnected_components_are_not_reachable(db_session):
    import_area_id = _import_area_id(db_session)
    road = _road(db_session, import_area_id)
    a = _node(db_session, import_area_id, "node/a", Coordinate(30.0, -97.801))
    b = _node(db_session, import_area_id, "node/b", Coordinate(30.0, -97.8005))
    x = _node(db_session, import_area_id, "node/x", Coordinate(30.0009, -97.7995))
    y = _node(db_session, import_area_id, "node/y", Coordinate(30.0009, -97.799))
    _segment(db_session, road.id, a, b)
    _segment(db_session, road.id, x, y)

    graph = load_road_graph(db_session, import_area_id)

    assert y.id not in _reachable_nodes(graph, a.id)


def test_graph_is_isolated_by_import_area(db_session):
    area_a = _import_area_id(db_session, Coordinate(29.999, -97.801), Coordinate(30.001, -97.799))
    area_b = _import_area_id(db_session, Coordinate(31.0, -98.801), Coordinate(31.001, -98.799))
    road_a = _road(db_session, area_a, "way/a")
    road_b = _road(db_session, area_b, "way/b")
    a1 = _node(db_session, area_a, "node/a1", Coordinate(30.0, -97.801))
    a2 = _node(db_session, area_a, "node/a2", Coordinate(30.0, -97.799))
    b1 = _node(db_session, area_b, "node/b1", Coordinate(31.0, -98.801))
    b2 = _node(db_session, area_b, "node/b2", Coordinate(31.0, -98.799))
    _segment(db_session, road_a.id, a1, a2)
    _segment(db_session, road_b.id, b1, b2)

    graph = load_road_graph(db_session, area_a)

    assert b1.id not in graph.nodes
    assert b2.id not in graph.nodes


def test_graph_has_no_provider_or_persistence_types_in_its_public_shape(db_session):
    import_area_id = _import_area_id(db_session)
    road = _road(db_session, import_area_id)
    a = _node(db_session, import_area_id, "node/a", Coordinate(30.0, -97.801))
    b = _node(db_session, import_area_id, "node/b", Coordinate(30.0, -97.799))
    _segment(db_session, road.id, a, b)

    graph = load_road_graph(db_session, import_area_id)
    edge = graph.edge(next(iter(graph.edges_by_id)))

    assert isinstance(edge.id, type(a.id))
    assert isinstance(edge.distance_meters, float)
