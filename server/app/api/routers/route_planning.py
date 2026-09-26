"""Route endpoint (design.md Decision 8): plans a route between two
coordinates with a selectable, named strategy."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import completed_import_area, get_session
from app.api.errors import ApiError
from app.api.mappers import route_out
from app.api.schemas import RouteOut, RouteRequest
from app.domain.bounding_box import Coordinate, InvalidBoundingBox
from app.domain.geometry import point_distance_meters
from app.domain.import_area import ImportArea
from app.persistence.repositories.road_graph import NavigableNodeRepository
from app.routing.engine import RoutingEngine
from app.routing.strategies import DEFAULT_STRATEGY_NAME, UnknownRoutingStrategy, resolve_strategy

router = APIRouter(tags=["routes"])


def _as_coordinate(latitude: float, longitude: float) -> Coordinate:
    try:
        return Coordinate(latitude, longitude)
    except InvalidBoundingBox as exc:
        raise ApiError(422, "invalid_coordinate", str(exc)) from exc


@router.post("/import-areas/{import_area_id}/routes", response_model=RouteOut)
def create_route(
    body: RouteRequest,
    area: ImportArea = Depends(completed_import_area),
    session: Session = Depends(get_session),
) -> RouteOut:
    origin = _as_coordinate(body.origin.latitude, body.origin.longitude)
    destination = _as_coordinate(body.destination.latitude, body.destination.longitude)

    try:
        strategy = resolve_strategy(body.strategy)
    except UnknownRoutingStrategy as exc:
        raise ApiError(
            422, "unknown_routing_strategy", str(exc), {"registered_strategies": exc.registered_names}
        ) from exc

    # The engine returns only the route, not the nodes it snapped onto, so the
    # endpoints are read back from the route itself. Repeating the
    # nearest-node lookup here could pick a different node on a distance tie
    # and contradict node_ids[0] / node_ids[-1].
    route = RoutingEngine(session, strategy).plan_route(area.id, origin, destination)
    nodes = NavigableNodeRepository(session)
    origin_node = nodes.get(route.node_ids[0])
    destination_node = nodes.get(route.node_ids[-1])

    return route_out(
        route,
        strategy=body.strategy or DEFAULT_STRATEGY_NAME,
        origin_node_id=origin_node.id,
        destination_node_id=destination_node.id,
        origin_snap_distance_meters=point_distance_meters(origin, origin_node.point),
        destination_snap_distance_meters=point_distance_meters(destination, destination_node.point),
    )
