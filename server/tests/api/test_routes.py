import json
from pathlib import Path

ROUTING_FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_routing.json"


def _import_routing_fixture(client):
    payload = json.loads(ROUTING_FIXTURE.read_text())
    bbox = {"min_latitude": 9.9995, "min_longitude": -84.003, "max_latitude": 10.002, "max_longitude": -83.999}
    return client.post("/import-areas", json={"bbox": bbox, "payload": payload}).json()


def _route_body(origin, destination, strategy=None):
    body = {"origin": {"latitude": origin[0], "longitude": origin[1]},
            "destination": {"latitude": destination[0], "longitude": destination[1]}}
    if strategy is not None:
        body["strategy"] = strategy
    return body


def test_end_to_end_import_then_route(client):
    area = _import_routing_fixture(client)

    response = client.post(
        f"/import-areas/{area['id']}/routes",
        json=_route_body((10.0, -84.000), (10.0, -84.002)),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total_distance_meters"] > 0
    assert len(body["node_ids"]) >= 2
    assert body["strategy"] == "distance"


def test_repeated_route_is_deterministic(client):
    area = _import_routing_fixture(client)
    request = _route_body((10.0, -84.000), (10.0, -84.002))

    first = client.post(f"/import-areas/{area['id']}/routes", json=request).json()
    second = client.post(f"/import-areas/{area['id']}/routes", json=request).json()

    assert first["node_ids"] == second["node_ids"]
    assert first["segment_ids"] == second["segment_ids"]
    assert first["total_distance_meters"] == second["total_distance_meters"]


def test_default_strategy_is_reported(client):
    area = _import_routing_fixture(client)

    response = client.post(
        f"/import-areas/{area['id']}/routes",
        json=_route_body((10.0, -84.000), (10.0, -84.002)),
    )

    assert response.json()["strategy"] == "distance"


def test_route_reports_snap_distances(client):
    area = _import_routing_fixture(client)

    response = client.post(
        f"/import-areas/{area['id']}/routes",
        json=_route_body((10.0001, -84.0001), (10.0, -84.002)),
    )

    body = response.json()
    assert body["origin_snap_distance_meters"] >= 0
    assert body["destination_snap_distance_meters"] >= 0


def test_route_with_same_origin_and_destination_node(client):
    area = _import_routing_fixture(client)

    response = client.post(
        f"/import-areas/{area['id']}/routes",
        json=_route_body((10.0, -84.000), (10.0, -84.000)),
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["node_ids"]) == 1
    assert body["segment_ids"] == []
    assert body["geometry"] is None
    assert body["total_distance_meters"] == 0


def test_out_of_range_coordinate_is_rejected(client):
    area = _import_routing_fixture(client)

    response = client.post(
        f"/import-areas/{area['id']}/routes",
        json=_route_body((300.0, -84.000), (10.0, -84.002)),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_coordinate"


def test_unknown_strategy_lists_registered_names(client):
    area = _import_routing_fixture(client)

    response = client.post(
        f"/import-areas/{area['id']}/routes",
        json=_route_body((10.0, -84.000), (10.0, -84.002), strategy="teleport"),
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "unknown_routing_strategy"
    assert "distance" in body["error"]["details"]["registered_strategies"]


def test_no_route_found_between_disconnected_points(client, db_session):
    from app.domain.bounding_box import BoundingBox, Coordinate
    from app.domain.road_graph import NavigableNode
    from app.persistence.repositories.import_area import ImportAreaRepository
    from app.persistence.repositories.road_graph import NavigableNodeRepository

    bbox = BoundingBox(min_corner=Coordinate(60.0, 20.0), max_corner=Coordinate(60.005, 20.005))
    area = ImportAreaRepository(db_session).get_or_create("osm", bbox)
    node_repo = NavigableNodeRepository(db_session)
    node_repo.upsert(NavigableNode(id=None, import_area_id=area.id, source_id="node/a", point=Coordinate(60.001, 20.001)))
    node_repo.upsert(NavigableNode(id=None, import_area_id=area.id, source_id="node/b", point=Coordinate(60.002, 20.002)))
    ImportAreaRepository(db_session).mark_completed(
        area.id, road_count=0, node_count=2, building_count=0, poi_count=0, area_feature_count=0
    )

    response = client.post(
        f"/import-areas/{area.id}/routes",
        json=_route_body((60.001, 20.001), (60.002, 20.002)),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "no_route_found"


def test_no_navigable_node_when_area_has_no_road_data(client, db_session):
    from app.domain.bounding_box import BoundingBox, Coordinate
    from app.persistence.repositories.import_area import ImportAreaRepository

    bbox = BoundingBox(min_corner=Coordinate(61.0, 21.0), max_corner=Coordinate(61.005, 21.005))
    area = ImportAreaRepository(db_session).get_or_create("osm", bbox)
    ImportAreaRepository(db_session).mark_completed(
        area.id, road_count=0, node_count=0, building_count=0, poi_count=0, area_feature_count=0
    )

    response = client.post(
        f"/import-areas/{area.id}/routes",
        json=_route_body((61.001, 21.001), (61.002, 21.002)),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "no_navigable_node"
