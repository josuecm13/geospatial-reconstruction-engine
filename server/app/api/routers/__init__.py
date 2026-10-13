from app.api.routers.generation import router as generation_router
from app.api.routers.import_areas import router as import_areas_router
from app.api.routers.places import router as places_router
from app.api.routers.route_planning import router as route_planning_router
from app.api.routers.settings import router as settings_router
from app.api.routers.spatial_queries import router as spatial_queries_router
from app.api.routers.traced_boundaries import router as traced_boundaries_router

__all__ = [
    "generation_router",
    "import_areas_router",
    "places_router",
    "route_planning_router",
    "settings_router",
    "spatial_queries_router",
    "traced_boundaries_router",
]
