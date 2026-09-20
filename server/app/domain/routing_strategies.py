import heapq
import math
import uuid

from app.domain.graph import GraphEdge, RoadGraph
from app.domain.routing import RouteResult

# The search state is the edge just traversed, or None meaning "at the origin,
# no turn made yet". A state's current node is implicit: None -> the origin
# node; an edge -> that edge's to_node_id. Keying on the edge rather than the
# node is what lets turn legality (which depends on how you arrived) affect
# the search at all.
_State = uuid.UUID | None


class DistanceDijkstraStrategy:
    """Turn-aware shortest-path search minimising total travelled distance."""

    def find_route(
        self, graph: RoadGraph, origin_node_id: uuid.UUID, destination_node_id: uuid.UUID
    ) -> RouteResult | None:
        if origin_node_id == destination_node_id:
            return RouteResult(node_ids=(origin_node_id,), segment_ids=(), geometry=(), total_distance_meters=0.0)

        best_distance: dict[_State, float] = {None: 0.0}
        came_from: dict[_State, _State] = {}
        # Tie-break on the edge id (a stable identity), not push order or
        # dict/set iteration order, so equal-cost ties resolve deterministically.
        frontier: list[tuple[float, str, _State]] = [(0.0, "", None)]

        while frontier:
            distance, _, state = heapq.heappop(frontier)
            if distance > best_distance.get(state, math.inf):
                continue  # a shorter path to this state was already found

            if state is None:
                successors = graph.edges_departing(origin_node_id)
            else:
                if graph.edge(state).to_node_id == destination_node_id:
                    return self._reconstruct(graph, came_from, state, origin_node_id)
                successors = graph.legal_continuations(state)

            for edge in successors:
                new_distance = distance + edge.distance_meters
                if new_distance < best_distance.get(edge.id, math.inf):
                    best_distance[edge.id] = new_distance
                    came_from[edge.id] = state
                    heapq.heappush(frontier, (new_distance, str(edge.id), edge.id))

        return None

    @staticmethod
    def _reconstruct(
        graph: RoadGraph, came_from: dict[_State, _State], final_edge_id: uuid.UUID, origin_node_id: uuid.UUID
    ) -> RouteResult:
        edge_ids: list[uuid.UUID] = []
        state: _State = final_edge_id
        while state is not None:
            edge_ids.append(state)
            state = came_from[state]
        edge_ids.reverse()

        edges: list[GraphEdge] = [graph.edge(edge_id) for edge_id in edge_ids]
        node_ids = (origin_node_id, *(edge.to_node_id for edge in edges))
        total_distance = sum(edge.distance_meters for edge in edges)

        geometry: list = list(edges[0].geom) if edges else []
        for edge in edges[1:]:
            geometry.extend(edge.geom[1:])  # drop the point shared with the previous edge's end

        return RouteResult(
            node_ids=node_ids,
            segment_ids=tuple(edge_ids),
            geometry=tuple(geometry),
            total_distance_meters=total_distance,
        )
