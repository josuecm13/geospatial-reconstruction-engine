import uuid

from sqlalchemy.orm import Session

from app.domain.graph import GraphEdge, RoadGraph
from app.persistence.repositories.road_graph import RoadSegmentRepository
from app.persistence.repositories.turn_movement import TurnMovementRepository


def load_road_graph(session: Session, import_area_id: uuid.UUID) -> RoadGraph:
    """Bulk-load one import area's segments and turn movements into a traversable graph.

    One query for segments, one for turn movements — not a lookup per node or
    per edge — so building the graph never puts N+1 round trips ahead of a
    search that will run entirely against the result.
    """
    segments = [
        segment
        for segment in RoadSegmentRepository(session).list_for_import_area(import_area_id)
        if segment.is_vehicle_accessible
    ]

    nodes: set[uuid.UUID] = set()
    edges_by_id: dict[uuid.UUID, GraphEdge] = {}
    edges_from_node: dict[uuid.UUID, list[uuid.UUID]] = {}
    for segment in segments:
        edges_by_id[segment.id] = GraphEdge(
            id=segment.id,
            from_node_id=segment.from_node_id,
            to_node_id=segment.to_node_id,
            geom=segment.geom,
            distance_meters=segment.distance_meters,
        )
        edges_from_node.setdefault(segment.from_node_id, []).append(segment.id)
        nodes.add(segment.from_node_id)
        nodes.add(segment.to_node_id)

    movements = TurnMovementRepository(session).list_allowed_for_segments(set(edges_by_id))
    legal_successors: dict[uuid.UUID, list[uuid.UUID]] = {}
    for movement in movements:
        # A movement onto a segment excluded above (not vehicle-accessible) is not a legal move.
        if movement.outgoing_segment_id in edges_by_id:
            legal_successors.setdefault(movement.incoming_segment_id, []).append(movement.outgoing_segment_id)

    return RoadGraph(
        nodes=frozenset(nodes),
        edges_by_id=edges_by_id,
        edges_from_node={node_id: tuple(edge_ids) for node_id, edge_ids in edges_from_node.items()},
        legal_successors={
            edge_id: tuple(outgoing_ids) for edge_id, outgoing_ids in legal_successors.items()
        },
    )
