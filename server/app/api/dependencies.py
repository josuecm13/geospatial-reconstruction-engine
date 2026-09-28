"""Session lifecycle: a dependency over a lazily-built engine.

The engine and its sessionmaker are created on first use from `load_settings()`,
not at import time, so importing `app.main` never requires `DATABASE_URL` to be
set. Tests override `get_session` with the `db_session` fixture via
`app.dependency_overrides`, so API tests share the same savepoint isolation as
the persistence tests — including `/health`, which depends on `get_session`
like every other endpoint rather than building its own engine.
"""

from __future__ import annotations

import uuid
from collections.abc import Generator

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.errors import ApiError
from app.config.settings import load_settings
from app.domain.enums import ImportStatus
from app.domain.import_area import ImportArea
from app.domain.traced_boundary import TracedBoundary
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.traced_boundary import TracedBoundaryRepository

_engine: Engine | None = None
_session_factory: sessionmaker | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(load_settings().database_url)
    return _engine


def get_session() -> Generator[Session, None, None]:
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine())
    session = _session_factory()
    try:
        yield session
    finally:
        session.close()


def import_area(import_area_id: uuid.UUID, session: Session = Depends(get_session)) -> ImportArea:
    area = ImportAreaRepository(session).get(import_area_id)
    if area is None:
        raise ApiError(404, "import_area_not_found", f"import area {import_area_id} not found")
    return area


def completed_import_area(area: ImportArea = Depends(import_area)) -> ImportArea:
    if area.status is not ImportStatus.COMPLETED:
        raise ApiError(
            409,
            "import_area_not_ready",
            f"import area {area.id} is not ready (status={area.status.value})",
        )
    return area


def traced_boundary(
    boundary_id: uuid.UUID, area: ImportArea = Depends(import_area), session: Session = Depends(get_session)
) -> TracedBoundary:
    """A boundary of another import area is reported as not found, not as a mismatch."""
    boundary = TracedBoundaryRepository(session).get(boundary_id)
    if boundary is None or boundary.import_area_id != area.id:
        raise ApiError(404, "boundary_not_found", f"boundary {boundary_id} not found in import area {area.id}")
    return boundary
