"""`DELETE /import-areas/{id}`: a hard delete of the area and everything derived from it, refused
while its import runs and while a larger area borrows its features."""

import uuid

from sqlalchemy import func, select

from app.persistence.models import BuildingModel, RoadModel

from .test_background_import import NeverRunsExecutor, _payload as _background_payload, _start, _use_registry
from .test_nested_import_areas import _import_inner, _import_outer


def _count(db_session, model, area_id: str | None = None) -> int:
    query = select(func.count()).select_from(model)
    if area_id is not None:
        query = query.where(model.import_area_id == uuid.UUID(area_id))
    return db_session.scalar(query)


def test_a_deleted_area_is_gone_with_its_data(client, db_session):
    area = _import_inner(client)
    assert _count(db_session, RoadModel) > 0

    response = client.delete(f"/import-areas/{area['id']}")

    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"/import-areas/{area['id']}").status_code == 404
    map_data = client.get(f"/import-areas/{area['id']}/map-data")
    assert map_data.status_code == 404
    assert map_data.json()["error"]["code"] == "import_area_not_found"
    assert _count(db_session, RoadModel) == 0
    assert _count(db_session, BuildingModel) == 0
    assert client.get("/import-areas").json()["import_areas"] == []


def test_an_unknown_area_is_not_found(client):
    response = client.delete(f"/import-areas/{uuid.uuid4()}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "import_area_not_found"


def test_an_area_whose_import_is_running_is_refused(client, db_session):
    _use_registry(client, db_session, NeverRunsExecutor())
    area_id = _start(client, _background_payload()).json()["import_area_id"]

    response = client.delete(f"/import-areas/{area_id}")

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "import_in_progress"
    assert error["details"]["import_area_id"] == area_id
    assert client.get(f"/import-areas/{area_id}").status_code == 200


def test_an_inner_area_borrowed_by_a_larger_one_is_refused(client, db_session):
    inner = _import_inner(client)
    outer = _import_outer(client)
    roads_before = _count(db_session, RoadModel)

    response = client.delete(f"/import-areas/{inner['id']}")

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "import_area_in_use"
    assert error["details"] == {"covering_areas": [{"id": outer["id"], "name": None}]}
    assert client.get(f"/import-areas/{inner['id']}").status_code == 200
    assert _count(db_session, RoadModel) == roads_before


def test_deleting_the_outer_area_leaves_the_inner_one_intact(client, db_session):
    inner = _import_inner(client)
    outer = _import_outer(client)
    inner_roads = _count(db_session, RoadModel, inner["id"])

    response = client.delete(f"/import-areas/{outer['id']}")

    assert response.status_code == 204
    assert client.get(f"/import-areas/{outer['id']}").status_code == 404
    assert _count(db_session, RoadModel) == inner_roads
    assert _count(db_session, RoadModel, outer["id"]) == 0
    map_data = client.get(f"/import-areas/{inner['id']}/map-data")
    assert map_data.status_code == 200
    assert len(map_data.json()["buildings"]["features"]) == inner["building_count"]
