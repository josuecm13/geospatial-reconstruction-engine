import uuid
from dataclasses import dataclass

from app.domain.enums import MovementKind, RestrictionKind


@dataclass(frozen=True)
class TurnMovement:
    id: uuid.UUID | None
    intersection_node_id: uuid.UUID
    incoming_segment_id: uuid.UUID
    outgoing_segment_id: uuid.UUID
    movement_kind: MovementKind
    allowed: bool = True
    restriction_kind: RestrictionKind = RestrictionKind.NONE
