from fastapi import FastAPI, HTTPException

from app.config.database import check_connection, make_engine
from app.config.settings import MissingEnvironmentVariable, load_settings


def create_app() -> FastAPI:
    app = FastAPI(title="Geospatial Reconstruction Engine")

    @app.get("/health")
    def health() -> dict:
        try:
            settings = load_settings()
        except MissingEnvironmentVariable as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        try:
            check_connection(make_engine(settings))
        except Exception as exc:
            raise HTTPException(
                status_code=503, detail=f"database unreachable: {exc}"
            ) from exc

        return {"status": "ok"}

    return app


app = create_app()
