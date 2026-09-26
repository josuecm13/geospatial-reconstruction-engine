from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.api.errors import register_error_handlers
from app.api.middleware import BodySizeLimitMiddleware
from app.api.routers import import_areas_router, route_planning_router, spatial_queries_router


def create_app() -> FastAPI:
    app = FastAPI(title="Geospatial Reconstruction Engine")
    app.add_middleware(BodySizeLimitMiddleware)
    register_error_handlers(app)
    app.include_router(import_areas_router)
    app.include_router(spatial_queries_router)
    app.include_router(route_planning_router)

    @app.get("/health")
    def health(session: Session = Depends(get_session)) -> dict:
        session.execute(text("SELECT 1"))
        return {"status": "ok"}

    return app


app = create_app()
