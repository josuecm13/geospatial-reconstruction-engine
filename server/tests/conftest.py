import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config.settings import load_settings


@pytest.fixture(scope="session")
def engine():
    settings = load_settings()
    return create_engine(settings.database_url)


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
