import uuid

from sqlalchemy.orm import Session

from app.domain.bounding_box import Coordinate
from app.domain.routing import RouteResult, RoutingStrategy
from app.domain.routing_strategies import DistanceDijkstraStrategy
from app.persistence.graph_loader import load_road_graph
from app.persistence.spatial_queries import SpatialQueryService


class RoutingError(RuntimeError):
    """Base class for actionable routing failures (not a Python-level bug)."""


class NoNavigableNodeError(RoutingError):
    """The import area has no navigable node to snap a coordinate onto."""


class NoRouteFoundError(RoutingError):
    """No legal path connects the prepared origin and destination."""


class RoutingEngine:
    """Prepares a route request and delegates the search to a substitutable strategy.

    Depends on `SpatialQueryService` and the graph loader to prepare a request,
    but the search itself runs entirely against the pure `RoadGraph`/`RoutingStrategy`
    contract — this class is the only place SQL and routing meet.
    """

    def __init__(self, session: Session, strategy: RoutingStrategy | None = None):
        self.session = session
        self.strategy = strategy or DistanceDijkstraStrategy()

    def plan_route(self, import_area_id: uuid.UUID, origin: Coordinate, destination: Coordinate) -> RouteResult:
        spatial = SpatialQueryService(self.session)

        origin_node = spatial.nearest_node(import_area_id, origin)
        destination_node = spatial.nearest_node(import_area_id, destination)
        if origin_node is None or destination_node is None:
            raise NoNavigableNodeError(
                f"import area {import_area_id} has no navigable node to snap the requested coordinates onto"
            )

        graph = load_road_graph(self.session, import_area_id)
        route = self.strategy.find_route(graph, origin_node.id, destination_node.id)
        if route is None:
            raise NoRouteFoundError(
                f"no legal route exists from {origin_node.id} to {destination_node.id} in import area {import_area_id}"
            )
        return route
