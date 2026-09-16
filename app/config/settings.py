import os
from dataclasses import dataclass


class MissingEnvironmentVariable(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    database_url: str


def load_settings() -> Settings:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise MissingEnvironmentVariable(
            "DATABASE_URL is not set. Copy .env.example to .env and fill it in, "
            "or export DATABASE_URL directly."
        )
    return Settings(database_url=database_url)
