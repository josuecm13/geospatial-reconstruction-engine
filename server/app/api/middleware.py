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
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

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
