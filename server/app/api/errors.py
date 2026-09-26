"""The single error response shape and the status/code mapping for every
failure class the API reports (design.md Decision 2).

Every non-2xx response is `{"error": {"code", "message", "details"}}`.
`ApiError` is how routers and dependencies raise a specific code themselves
(e.g. `import_area_not_found`); everything else is mapped centrally here from
the exception types the domain/persistence/ingestion/routing layers already
raise, so there is exactly one place that decides the mapping.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import InterfaceError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.config.settings import MissingEnvironmentVariable
from app.domain.bounding_box import InvalidBoundingBox
from app.ingestion.osm_adapter import OSMIngestionError, PayloadOutsideBoundingBox
from app.persistence.spatial_queries import InvalidSpatialQuery
from app.routing.engine import NoNavigableNodeError, NoRouteFoundError

logger = logging.getLogger(__name__)


class ApiError(Exception):
    """Raised by routers/dependencies for a code only the call site knows,
    e.g. distinguishing `import_area_not_found` from `building_not_found`,
    both of which come from the same `UnknownImportArea`."""

    def __init__(self, status_code: int, code: str, message: str, details: dict[str, Any] | None = None):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)


def build_error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


def _response(status_code: int, code: str, message: str, details: dict[str, Any] | None = None) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=build_error_body(code, message, details))


def _database_unavailable() -> JSONResponse:
    return _response(503, "database_unavailable", "the database is currently unavailable")


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return _response(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [{"loc": list(error["loc"]), "msg": error["msg"]} for error in exc.errors()]
        return _response(422, "invalid_request", "request validation failed", {"fields": fields})

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return _response(404, "not_found", "resource not found")
        if exc.status_code == 405:
            return _response(405, "method_not_allowed", "method not allowed")
        return _response(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(PayloadOutsideBoundingBox)
    async def handle_payload_outside_bbox(request: Request, exc: PayloadOutsideBoundingBox) -> JSONResponse:
        return _response(422, "payload_outside_bounding_box", str(exc), {"source_ids": exc.source_ids})

    @app.exception_handler(InvalidBoundingBox)
    async def handle_invalid_bounding_box(request: Request, exc: InvalidBoundingBox) -> JSONResponse:
        return _response(422, "invalid_bounding_box", str(exc))

    @app.exception_handler(InvalidSpatialQuery)
    async def handle_invalid_spatial_query(request: Request, exc: InvalidSpatialQuery) -> JSONResponse:
        return _response(422, "invalid_spatial_query", str(exc))

    @app.exception_handler(OSMIngestionError)
    async def handle_ingestion_error(request: Request, exc: OSMIngestionError) -> JSONResponse:
        # PayloadOutsideBoundingBox is a subclass of OSMIngestionError, but
        # Starlette dispatches to the most specific registered handler first
        # (via the exception's MRO), so that case never reaches this one.
        cause = exc.__cause__
        if isinstance(cause, (OperationalError, InterfaceError)):
            return _database_unavailable()
        return _response(422, "ingestion_failed", str(exc))

    @app.exception_handler(NoNavigableNodeError)
    async def handle_no_navigable_node(request: Request, exc: NoNavigableNodeError) -> JSONResponse:
        return _response(422, "no_navigable_node", str(exc))

    @app.exception_handler(NoRouteFoundError)
    async def handle_no_route_found(request: Request, exc: NoRouteFoundError) -> JSONResponse:
        return _response(422, "no_route_found", str(exc))

    @app.exception_handler(OperationalError)
    async def handle_operational_error(request: Request, exc: OperationalError) -> JSONResponse:
        return _database_unavailable()

    @app.exception_handler(InterfaceError)
    async def handle_interface_error(request: Request, exc: InterfaceError) -> JSONResponse:
        return _database_unavailable()

    @app.exception_handler(MissingEnvironmentVariable)
    async def handle_missing_env(request: Request, exc: MissingEnvironmentVariable) -> JSONResponse:
        return _response(500, "configuration_error", "the server is misconfigured")

    @app.exception_handler(Exception)
    async def handle_generic_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error while serving %s %s", request.method, request.url)
        return _response(500, "internal_error", "an unexpected error occurred")
