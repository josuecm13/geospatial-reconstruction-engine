import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_geocoder, get_overpass_client, get_session
from app.main import create_app


class NoNetworkOverpass:
    """The default live source in tests: CI never reaches the network. A test that needs a live
    response overrides `get_overpass_client` with recorded data."""

    def fetch(self, bbox):
        raise AssertionError("a test tried to fetch from Overpass; override get_overpass_client")


@pytest.fixture()
def client(db_session):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: db_session
    app.dependency_overrides[get_overpass_client] = NoNetworkOverpass
    # No place-name lookups in tests: CI never reaches Nominatim. A test that wants a name overrides this.
    app.dependency_overrides[get_geocoder] = lambda: None
    # Starlette's generic Exception -> 500 handler runs on the outermost
    # ServerErrorMiddleware, which re-raises after building the response so
    # an ASGI server can log it. raise_server_exceptions=False makes the test
    # client see the same response a real client would, instead of the raised
    # exception.
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()
