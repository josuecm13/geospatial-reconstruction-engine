import uuid
from dataclasses import dataclass
from typing import Protocol

from app.domain.geometry import LineString
from app.domain.graph import RoadGraph


@dataclass(frozen=True)
class RouteResult:
    node_ids: tuple[uuid.UUID, ...]
    segment_ids: tuple[uuid.UUID, ...]
    geometry: LineString
    total_distance_meters: float


class RoutingStrategy(Protocol):
    """A substitutable search algorithm over a `RoadGraph`.

    Depends only on the graph abstraction — never SQL, persistence models, or
    provider-specific types — so `RoutingEngine` can be given any
    implementation of this contract without changing.
    """

    def find_route(
        self, graph: RoadGraph, origin_node_id: uuid.UUID, destination_node_id: uuid.UUID
    ) -> RouteResult | None:
        """Return a route, or None if no legal route exists between the two nodes."""
        ...
