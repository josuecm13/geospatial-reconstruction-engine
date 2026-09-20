import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.routing import RouteResult
from app.ingestion.service import OSMIngestionService
from app.persistence.models import RoadSegmentModel
from app.persistence.repositories.import_area import ImportAreaRepository
from app.routing.engine import NoNavigableNodeError, NoRouteFoundError, RoutingEngine

FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_routing.json"


def _bbox():
    return BoundingBox(Coordinate(9.999, -84.003), Coordinate(10.002, -83.999))


def _import_routing_fixture(db_session, *, with_straight_on_restriction=False, with_all_blocked=False):
    payload = json.loads(FIXTURE.read_text())
    if with_all_blocked:
        payload["elements"].append(
            {
                "type": "relation", "id": 900,
                "members": [
                    {"type": "way", "ref": 10, "role": "from"},
                    {"type": "node", "ref": 2, "role": "via"},
                    {"type": "way", "ref": 11, "role": "to"},
                ],
                "tags": {"type": "restriction", "restriction": "no_straight_on"},
            }
        )
        payload["elements"].append(
            {
                "type": "relation", "id": 901,
                "members": [
                    {"type": "way", "ref": 10, "role": "from"},
                    {"type": "node", "ref": 2, "role": "via"},
                    {"type": "way", "ref": 12, "role": "to"},
                ],
                "tags": {"type": "restriction", "restriction": "no_right_turn"},
            }
        )
    elif with_straight_on_restriction:
        payload["elements"].append(
            {
                "type": "relation", "id": 900,
                "members": [
                    {"type": "way", "ref": 10, "role": "from"},
                    {"type": "node", "ref": 2, "role": "via"},
                    {"type": "way", "ref": 11, "role": "to"},
                ],
                "tags": {"type": "restriction", "restriction": "no_straight_on"},
            }
        )
    return OSMIngestionService(db_session).import_fixture(_bbox(), payload).import_area.id


def test_shorter_of_two_legal_routes_is_chosen(db_session):
    import_area_id = _import_routing_fixture(db_session)

    route = RoutingEngine(db_session).plan_route(
        import_area_id, Coordinate(10.0000, -84.0000), Coordinate(10.0000, -84.0020)
    )

    assert len(route.segment_ids) == 2  # the direct A-B-C path, not the 4-segment detour


def test_prohibited_turn_forces_a_longer_legal_route(db_session):
    import_area_id = _import_routing_fixture(db_session, with_straight_on_restriction=True)

    route = RoutingEngine(db_session).plan_route(
        import_area_id, Coordinate(10.0000, -84.0000), Coordinate(10.0000, -84.0020)
    )

    assert len(route.segment_ids) == 4  # forced onto the detour


def test_every_alternative_prohibited_reports_no_route(db_session):
    import_area_id = _import_routing_fixture(db_session, with_all_blocked=True)

    with pytest.raises(NoRouteFoundError):
        RoutingEngine(db_session).plan_route(
            import_area_id, Coordinate(10.0000, -84.0000), Coordinate(10.0000, -84.0020)
        )


def test_route_result_contents_and_total_distance_matches_segments(db_session):
    import_area_id = _import_routing_fixture(db_session)

    route = RoutingEngine(db_session).plan_route(
        import_area_id, Coordinate(10.0000, -84.0000), Coordinate(10.0000, -84.0020)
    )

    assert len(route.node_ids) == len(route.segment_ids) + 1
    assert len(route.geometry) > 0

    persisted_distances = db_session.execute(
        select(RoadSegmentModel.distance_meters).where(RoadSegmentModel.id.in_(route.segment_ids))
    ).scalars().all()
    assert route.total_distance_meters == pytest.approx(sum(persisted_distances))


def test_disconnected_destination_reports_no_route(db_session):
    import_area_id = _import_routing_fixture(db_session)
    # An isolated node with no segments at all cannot be snapped into any route.
    from app.domain.road_graph import NavigableNode
    from app.persistence.repositories.road_graph import NavigableNodeRepository

    isolated = NavigableNodeRepository(db_session).upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/isolated", point=Coordinate(10.0015, -83.9995))
    )

    with pytest.raises(NoRouteFoundError):
        RoutingEngine(db_session).plan_route(import_area_id, Coordinate(10.0000, -84.0000), isolated.point)


def test_import_area_with_no_navigable_nodes_raises(db_session):
    import_area_id = ImportAreaRepository(db_session).get_or_create("osm", _bbox()).id

    with pytest.raises(NoNavigableNodeError):
        RoutingEngine(db_session).plan_route(
            import_area_id, Coordinate(10.0000, -84.0000), Coordinate(10.0000, -84.0020)
        )


def test_repeated_identical_requests_return_the_same_route(db_session):
    import_area_id = _import_routing_fixture(db_session)
    engine = RoutingEngine(db_session)

    first = engine.plan_route(import_area_id, Coordinate(10.0000, -84.0000), Coordinate(10.0000, -84.0020))
    second = engine.plan_route(import_area_id, Coordinate(10.0000, -84.0000), Coordinate(10.0000, -84.0020))

    assert first == second


def test_an_alternate_strategy_can_be_substituted_without_changing_the_engine(db_session):
    import_area_id = _import_routing_fixture(db_session)
    sentinel = RouteResult(node_ids=(), segment_ids=(), geometry=(), total_distance_meters=0.0)

    class _AlwaysReturnsSentinel:
        def find_route(self, graph, origin_node_id, destination_node_id):
            return sentinel

    route = RoutingEngine(db_session, strategy=_AlwaysReturnsSentinel()).plan_route(
        import_area_id, Coordinate(10.0000, -84.0000), Coordinate(10.0000, -84.0020)
    )

    assert route is sentinel
