"""Body-size guard at the trust boundary (design.md Decision 3).

Rejects an oversized request before its body is parsed. Middleware added via
`add_middleware` runs *outside* FastAPI's exception-handling machinery
(ExceptionMiddleware sits between it and the router), so raising here would
bypass `app/api/errors.py`'s registered handlers entirely — this returns the
same error shape directly instead of relying on them.

Only checks `Content-Length`, so a chunked request with no declared length
bypasses the check; acceptable at this project's scale, not a full defense.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api.errors import build_error_body

MAX_BODY_BYTES = 16 * 1024 * 1024  # 16 MiB


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except ValueError:
                declared_size = None
            if declared_size is not None and declared_size > MAX_BODY_BYTES:
                return JSONResponse(
                    status_code=413,
                    content=build_error_body(
                        "payload_too_large",
                        f"request body exceeds the {MAX_BODY_BYTES} byte limit",
                    ),
                )
        return await call_next(request)


class CompressionMiddleware:
    """Gzips responses over 1 KB, except the server-sent event streams.

    Starlette 0.41's `GZipMiddleware` has no `text/event-stream` exclusion, and its compressor
    buffers chunks, so wrapping the stage-event stream (`GET /import-areas/{id}/events`) would
    delay or batch the events and break the client's live progress. This sends such a request
    straight to the app, uncompressed: any HTTP request whose path ends with `/events`, or whose
    `Accept` header includes `text/event-stream`. Everything else goes through `GZipMiddleware`
    (level 6; 9 is slow on multi-megabyte `map-data` bodies for little gain).

    Pure ASGI on purpose: `BaseHTTPMiddleware` buffers streaming responses.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._gzip = GZipMiddleware(app, minimum_size=1000, compresslevel=6)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and self._is_event_stream(scope):
            await self.app(scope, receive, send)
            return
        await self._gzip(scope, receive, send)

    @staticmethod
    def _is_event_stream(scope: Scope) -> bool:
        if scope["path"].endswith("/events"):
            return True
        for name, value in scope["headers"]:
            if name == b"accept" and b"text/event-stream" in value:
                return True
        return False
