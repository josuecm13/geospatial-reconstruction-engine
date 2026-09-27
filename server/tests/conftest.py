import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import Session, sessionmaker

from app.config.settings import load_settings

SERVER_DIR = Path(__file__).resolve().parents[1]


def resolve_test_database_url(database_url: str) -> URL:
    """The database the tests run against: never the development one.

    `TEST_DATABASE_URL` when set, otherwise `DATABASE_URL` with `_test` appended
    to its database name, so data imported through the running app can't leak
    into test assertions.
    """
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return make_url(explicit)
    url = make_url(database_url)
    return url.set(database=f"{url.database}_test")


def _create_database_if_missing(server_url: URL, name: str) -> None:
    # CREATE DATABASE can't run inside a transaction, hence AUTOCOMMIT.
    admin_engine = create_engine(server_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            exists = connection.scalar(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name})
            if not exists:
                connection.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        admin_engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def test_database():
    dev_url = make_url(load_settings().database_url)
    url = resolve_test_database_url(dev_url.render_as_string(hide_password=False))
    if url.database == dev_url.database and url.host == dev_url.host and url.port == dev_url.port:
        pytest.exit("The test database must not be the development database (DATABASE_URL).", returncode=2)
    _create_database_if_missing(dev_url, url.database)

    rendered = url.render_as_string(hide_password=False)
    # alembic/env.py and the app's lazily created engine both read DATABASE_URL,
    # so point it at the test database for the whole session.
    original = os.environ["DATABASE_URL"]
    os.environ["DATABASE_URL"] = rendered
    alembic_config = Config(str(SERVER_DIR / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(SERVER_DIR / "alembic"))
    command.upgrade(alembic_config, "head")
    yield rendered
    os.environ["DATABASE_URL"] = original


@pytest.fixture(scope="session")
def engine(test_database):
    return create_engine(test_database)


@pytest.fixture()
def db_session(engine):
    # The outer transaction is never committed, so the test's data never reaches
    # the real database. join_transaction_mode="create_savepoint" makes the
    # session's own commit()/rollback() calls act on a SAVEPOINT instead of the
    # outer transaction, so application-level commit/rollback semantics (e.g. an
    # ingestion service committing an area before rolling back a failed import)
    # still behave the way they would against a real, uncontained connection.
    connection = engine.connect()
    transaction = connection.begin()
    session_factory = sessionmaker(bind=connection, join_transaction_mode="create_savepoint")
    session: Session = session_factory()

    yield session

    session.close()
    if transaction.is_active:
        transaction.rollback()
    connection.close()
