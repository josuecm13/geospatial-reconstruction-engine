import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_session
from app.main import create_app


@pytest.fixture()
def client(db_session):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: db_session
    # Starlette's generic Exception -> 500 handler runs on the outermost
    # ServerErrorMiddleware, which re-raises after building the response so
    # an ASGI server can log it. raise_server_exceptions=False makes the test
    # client see the same response a real client would, instead of the raised
    # exception.
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()
