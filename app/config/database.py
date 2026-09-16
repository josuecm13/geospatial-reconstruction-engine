from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.config.settings import Settings


def make_engine(settings: Settings) -> Engine:
    return create_engine(settings.database_url)


def check_connection(engine: Engine) -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
