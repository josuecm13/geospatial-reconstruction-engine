import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_session
from app.main import create_app


@pytest.fixture()
def client(db_session):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
