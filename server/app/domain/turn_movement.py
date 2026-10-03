import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from app.domain.enums import MovementKind, RestrictionKind
from app.domain.geometry import bearing_degrees, classify_turn
from app.domain.road_graph import RoadSegment


@dataclass(frozen=True)
class TurnMovement:
    id: uuid.UUID | None
    intersection_node_id: uuid.UUID
    incoming_segment_id: uuid.UUID
    outgoing_segment_id: uuid.UUID
    movement_kind: MovementKind
    allowed: bool = True
    restriction_kind: RestrictionKind = RestrictionKind.NONE


def turn_candidates(
    node_id: uuid.UUID, incoming: Sequence[RoadSegment], outgoing: Sequence[RoadSegment]
) -> list[TurnMovement]:
    """Every geometrically plausible incoming/outgoing pair at a node, default-allowed."""
    candidates = []
    for incoming_segment in incoming:
        incoming_bearing = bearing_degrees(incoming_segment.geom[-2], incoming_segment.geom[-1])
        for outgoing_segment in outgoing:
            outgoing_bearing = bearing_degrees(outgoing_segment.geom[0], outgoing_segment.geom[1])
            candidates.append(
                TurnMovement(
                    id=None,
                    intersection_node_id=node_id,
                    incoming_segment_id=incoming_segment.id,
                    outgoing_segment_id=outgoing_segment.id,
                    movement_kind=classify_turn(incoming_bearing, outgoing_bearing),
                    allowed=True,
                    restriction_kind=RestrictionKind.NONE,
                )
            )
    return candidates
