import uuid

from app.domain.area_feature import AreaFeature
from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.building import Building
from app.domain.enums import AreaFeatureKind, BuildingCategory
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.import_area import ImportAreaRepository


def _square_ring(min_lat, min_lon, max_lat, max_lon):
    return (
        Coordinate(min_lat, min_lon),
        Coordinate(min_lat, max_lon),
        Coordinate(max_lat, max_lon),
        Coordinate(max_lat, min_lon),
        Coordinate(min_lat, min_lon),
    )


def _completed_area_with_buildings(db_session):
    bbox = BoundingBox(min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.005, -97.795))
    area = ImportAreaRepository(db_session).get_or_create("osm", bbox)
    building_repo = BuildingRepository(db_session)
    close_building = building_repo.upsert(
        Building(id=None, import_area_id=area.id, source_id="way/close",
                  category=BuildingCategory.RESIDENTIAL, geom=_square_ring(30.0000, -97.8000, 30.0001, -97.7999))
    )
    far_building = building_repo.upsert(
        Building(id=None, import_area_id=area.id, source_id="way/far",
                  category=BuildingCategory.RESIDENTIAL, geom=_square_ring(30.004, -97.796, 30.0041, -97.7959))
    )
    ImportAreaRepository(db_session).mark_completed(
        area.id, road_count=0, node_count=0, building_count=2, poi_count=0, area_feature_count=0
    )
    return area.id, close_building, far_building


def test_nearby_radius_hit_and_empty_result(client, db_session):
    area_id, close_building, _ = _completed_area_with_buildings(db_session)

    hit = client.get(
        f"/import-areas/{area_id}/nearby",
        params={"latitude": 30.0000, "longitude": -97.8000, "radius_meters": 50, "kind": "building"},
    )
    empty = client.get(
        f"/import-areas/{area_id}/nearby",
        params={"latitude": 31.0, "longitude": -98.0, "radius_meters": 10, "kind": "building"},
    )

    assert hit.status_code == 200
    assert str(close_building.id) in [f["id"] for f in hit.json()["results"]]
    assert empty.status_code == 200
    assert empty.json()["results"] == []


def test_nonpositive_radius_is_rejected(client, db_session):
    area_id, _, _ = _completed_area_with_buildings(db_session)

    response = client.get(
        f"/import-areas/{area_id}/nearby",
        params={"latitude": 30.0, "longitude": -97.8, "radius_meters": 0, "kind": "building"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_spatial_query"


def test_nearby_rejects_out_of_range_coordinate(client, db_session):
    area_id, _, _ = _completed_area_with_buildings(db_session)

    response = client.get(
        f"/import-areas/{area_id}/nearby",
        params={"latitude": 300.0, "longitude": -97.8, "radius_meters": 10, "kind": "building"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_coordinate"


def test_contains_excludes_partial_overlap_while_intersects_includes_it(client, db_session):
    bbox = BoundingBox(min_corner=Coordinate(40.0, -70.0), max_corner=Coordinate(40.005, -69.995))
    area = ImportAreaRepository(db_session).get_or_create("osm", bbox)
    building_repo = BuildingRepository(db_session)
    fully_covered = building_repo.upsert(
        Building(id=None, import_area_id=area.id, source_id="way/covered", category=BuildingCategory.RESIDENTIAL,
                  geom=_square_ring(40.0010, -69.9990, 40.0011, -69.9989))
    )
    partially_overlapping = building_repo.upsert(
        Building(id=None, import_area_id=area.id, source_id="way/partial", category=BuildingCategory.RESIDENTIAL,
                  geom=_square_ring(40.0019, -69.9981, 40.0021, -69.9979))
    )
    ImportAreaRepository(db_session).mark_completed(
        area.id, road_count=0, node_count=0, building_count=2, poi_count=0, area_feature_count=0
    )
    query_box = {
        "min_latitude": 40.0005, "min_longitude": -69.9995, "max_latitude": 40.0020, "max_longitude": -69.9980,
    }

    contains = client.get(f"/import-areas/{area.id}/within-bbox", params={**query_box, "kind": "building", "mode": "contains"})
    intersects = client.get(f"/import-areas/{area.id}/within-bbox", params={**query_box, "kind": "building", "mode": "intersects"})

    contains_ids = {f["id"] for f in contains.json()["results"]}
    intersects_ids = {f["id"] for f in intersects.json()["results"]}
    assert contains_ids == {str(fully_covered.id)}
    assert intersects_ids >= {str(fully_covered.id), str(partially_overlapping.id)}


def test_within_bbox_rejects_oversized_query_box(client, db_session):
    area_id, _, _ = _completed_area_with_buildings(db_session)

    response = client.get(
        f"/import-areas/{area_id}/within-bbox",
        params={
            "min_latitude": 0.0, "min_longitude": 0.0, "max_latitude": 1.0, "max_longitude": 1.0,
            "kind": "building", "mode": "intersects",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_bounding_box"


def test_nearest_node_and_null_when_none_exist(client, db_session):
    from app.domain.road_graph import NavigableNode
    from app.persistence.repositories.road_graph import NavigableNodeRepository

    bbox = BoundingBox(min_corner=Coordinate(50.0, 10.0), max_corner=Coordinate(50.005, 10.005))
    area = ImportAreaRepository(db_session).get_or_create("osm", bbox)
    node = NavigableNodeRepository(db_session).upsert(
        NavigableNode(id=None, import_area_id=area.id, source_id="node/1", point=Coordinate(50.001, 10.001))
    )
    ImportAreaRepository(db_session).mark_completed(
        area.id, road_count=0, node_count=1, building_count=0, poi_count=0, area_feature_count=0
    )

    empty_bbox = BoundingBox(min_corner=Coordinate(51.0, 11.0), max_corner=Coordinate(51.005, 11.005))
    empty_area = ImportAreaRepository(db_session).get_or_create("osm", empty_bbox)
    ImportAreaRepository(db_session).mark_completed(
        empty_area.id, road_count=0, node_count=0, building_count=0, poi_count=0, area_feature_count=0
    )

    found = client.get(f"/import-areas/{area.id}/nearest", params={"latitude": 50.001, "longitude": 10.001, "kind": "node"})
    empty = client.get(f"/import-areas/{empty_area.id}/nearest", params={"latitude": 51.001, "longitude": 11.001, "kind": "node"})

    assert found.status_code == 200
    assert found.json()["result"]["id"] == str(node.id)
    assert empty.status_code == 200
    assert empty.json()["result"] is None


def test_footprint_area_and_building_not_found(client, db_session):
    area_id, close_building, _ = _completed_area_with_buildings(db_session)

    ok = client.get(f"/import-areas/{area_id}/buildings/{close_building.id}/footprint-area")
    missing = client.get(f"/import-areas/{area_id}/buildings/{uuid.uuid4()}/footprint-area")

    assert ok.status_code == 200
    assert ok.json()["area_square_meters"] > 0
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "building_not_found"
