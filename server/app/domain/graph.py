import uuid
from dataclasses import dataclass

from app.domain.geometry import LineString


@dataclass(frozen=True)
class GraphEdge:
    """One directed traversable move: exactly one persisted, vehicle-accessible road segment."""

    id: uuid.UUID
    from_node_id: uuid.UUID
    to_node_id: uuid.UUID
    geom: LineString
    distance_meters: float


@dataclass(frozen=True)
class RoadGraph:
    """A provider-neutral, in-memory view of one import area's road network.

    Turn legality is baked in at load time: `legal_continuations` only ever
    lists movements already recorded as allowed, so a caller never re-derives
    restriction semantics.
    """

    nodes: frozenset[uuid.UUID]
    edges_by_id: dict[uuid.UUID, GraphEdge]
    edges_from_node: dict[uuid.UUID, tuple[uuid.UUID, ...]]
    legal_successors: dict[uuid.UUID, tuple[uuid.UUID, ...]]

    def edge(self, edge_id: uuid.UUID) -> GraphEdge:
        return self.edges_by_id[edge_id]

    def edges_departing(self, node_id: uuid.UUID) -> tuple[GraphEdge, ...]:
        """Every outgoing edge of a node. No turn is being made, so nothing is restricted."""
        return tuple(self.edges_by_id[edge_id] for edge_id in self.edges_from_node.get(node_id, ()))

    def legal_continuations(self, incoming_edge_id: uuid.UUID) -> tuple[GraphEdge, ...]:
        """Outgoing edges legal to take immediately after traversing `incoming_edge_id`."""
        return tuple(self.edges_by_id[edge_id] for edge_id in self.legal_successors.get(incoming_edge_id, ()))
