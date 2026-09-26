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
