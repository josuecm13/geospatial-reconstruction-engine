import uuid


def test_health_ok(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_path_returns_not_found_contract(client):
    response = client.get("/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "resource not found", "details": None}}


def test_health_reports_database_unavailable(client, monkeypatch):
    from sqlalchemy.exc import OperationalError

    def _boom(self, *args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    monkeypatch.setattr("sqlalchemy.orm.Session.execute", _boom)

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"


def test_invalid_request_reports_field_details(client):
    response = client.post("/import-areas", json={"bbox": {"min_latitude": 1.0}})

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "invalid_request"
    assert body["error"]["details"]["fields"]


def test_query_reports_database_unavailable(client, monkeypatch):
    from sqlalchemy.exc import OperationalError

    from app.persistence.repositories.import_area import ImportAreaRepository

    def _boom(self, import_area_id):
        raise OperationalError("SELECT", {}, Exception("connection refused"))

    monkeypatch.setattr(ImportAreaRepository, "get", _boom)

    response = client.get(f"/import-areas/{uuid.uuid4()}")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"


def test_internal_error_omits_exception_text(client, monkeypatch):
    from app.persistence.repositories.import_area import ImportAreaRepository

    secret = "super secret connection string xyz123"

    def _boom(self, import_area_id):
        raise RuntimeError(secret)

    monkeypatch.setattr(ImportAreaRepository, "get", _boom)

    response = client.get(f"/import-areas/{uuid.uuid4()}")

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "internal_error"
    assert secret not in response.text


def test_integrity_error_outside_import_creation_is_internal_error(client, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    from app.persistence.repositories.import_area import ImportAreaRepository

    def _boom(self, import_area_id):
        raise IntegrityError("select", {}, Exception("constraint violation"))

    monkeypatch.setattr(ImportAreaRepository, "get", _boom)

    response = client.get(f"/import-areas/{uuid.uuid4()}")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
