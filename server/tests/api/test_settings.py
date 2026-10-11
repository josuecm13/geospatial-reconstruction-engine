"""`/settings/featured-area`: the import area the landing page features, chosen on the Locations page."""

import uuid

from .test_background_import import NeverRunsExecutor, _payload as _background_payload, _start, _use_registry
from .test_nested_import_areas import _import_inner, _import_outer


def test_unset_reads_as_null(client):
    response = client.get("/settings/featured-area")

    assert response.status_code == 200
    assert response.json() == {"import_area_id": None}


def test_a_completed_area_can_be_featured_and_read_back(client):
    area = _import_inner(client)

    put = client.put("/settings/featured-area", json={"import_area_id": area["id"]})

    assert put.status_code == 200
    assert put.json() == {"import_area_id": area["id"]}
    assert client.get("/settings/featured-area").json() == {"import_area_id": area["id"]}


def test_featuring_another_area_replaces_the_first(client):
    inner = _import_inner(client)
    outer = _import_outer(client)
    client.put("/settings/featured-area", json={"import_area_id": inner["id"]})

    client.put("/settings/featured-area", json={"import_area_id": outer["id"]})

    assert client.get("/settings/featured-area").json() == {"import_area_id": outer["id"]}


def test_an_unknown_area_is_not_found(client):
    response = client.put("/settings/featured-area", json={"import_area_id": str(uuid.uuid4())})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "import_area_not_found"
    assert client.get("/settings/featured-area").json() == {"import_area_id": None}


def test_an_area_that_has_not_completed_is_refused(client, db_session):
    _use_registry(client, db_session, NeverRunsExecutor())
    area_id = _start(client, _background_payload()).json()["import_area_id"]

    response = client.put("/settings/featured-area", json={"import_area_id": area_id})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "import_area_not_ready"
    assert client.get("/settings/featured-area").json() == {"import_area_id": None}


def test_null_clears_the_setting(client):
    area = _import_inner(client)
    client.put("/settings/featured-area", json={"import_area_id": area["id"]})

    response = client.put("/settings/featured-area", json={"import_area_id": None})

    assert response.status_code == 200
    assert response.json() == {"import_area_id": None}
    assert client.get("/settings/featured-area").json() == {"import_area_id": None}


def test_a_body_without_the_field_is_invalid(client):
    response = client.put("/settings/featured-area", json={})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_deleting_the_featured_area_clears_the_setting(client):
    area = _import_inner(client)
    client.put("/settings/featured-area", json={"import_area_id": area["id"]})

    assert client.delete(f"/import-areas/{area['id']}").status_code == 204

    assert client.get("/settings/featured-area").json() == {"import_area_id": None}


def test_deleting_another_area_keeps_the_setting(client):
    inner = _import_inner(client)
    outer = _import_outer(client)
    client.put("/settings/featured-area", json={"import_area_id": inner["id"]})

    assert client.delete(f"/import-areas/{outer['id']}").status_code == 204

    assert client.get("/settings/featured-area").json() == {"import_area_id": inner["id"]}


def test_landing_theme_unset_reads_as_null(client):
    response = client.get("/settings/landing-theme")

    assert response.status_code == 200
    assert response.json() == {"landing_theme": None}


def test_landing_theme_round_trips(client):
    chosen = {"theme": "realistic", "time_of_day": "golden-hour"}

    put = client.put("/settings/landing-theme", json={"landing_theme": chosen})

    assert put.status_code == 200
    assert put.json() == {"landing_theme": chosen}
    assert client.get("/settings/landing-theme").json() == {"landing_theme": chosen}


def test_landing_theme_null_clears_it(client):
    client.put("/settings/landing-theme", json={"landing_theme": {"theme": "blueprint", "time_of_day": "dawn"}})

    response = client.put("/settings/landing-theme", json={"landing_theme": None})

    assert response.status_code == 200
    assert response.json() == {"landing_theme": None}
    assert client.get("/settings/landing-theme").json() == {"landing_theme": None}


def test_an_unknown_theme_is_invalid_and_leaves_the_value(client):
    kept = {"theme": "light-clay", "time_of_day": "midday"}
    client.put("/settings/landing-theme", json={"landing_theme": kept})

    response = client.put("/settings/landing-theme", json={"landing_theme": {"theme": "neon", "time_of_day": "midday"}})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert client.get("/settings/landing-theme").json() == {"landing_theme": kept}


def test_an_unknown_time_of_day_is_invalid_and_leaves_the_value(client):
    kept = {"theme": "light-clay", "time_of_day": "midday"}
    client.put("/settings/landing-theme", json={"landing_theme": kept})

    response = client.put("/settings/landing-theme", json={"landing_theme": {"theme": "blueprint", "time_of_day": "teatime"}})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert client.get("/settings/landing-theme").json() == {"landing_theme": kept}


def test_a_landing_theme_body_without_the_field_is_invalid(client):
    response = client.put("/settings/landing-theme", json={})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
