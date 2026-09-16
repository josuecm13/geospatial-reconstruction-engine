import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import MovementKind, RestrictionKind
from app.domain.geometry import bearing_degrees, classify_turn
from app.domain.turn_movement import TurnMovement
from app.persistence.geometry import geom_to_linestring
from app.persistence.models import RoadSegmentModel, TurnMovementModel


class TurnMovementRepository:
    def __init__(self, session: Session):
        self.session = session

    def generate_candidates(self, intersection_node_id: uuid.UUID) -> list[TurnMovement]:
        """Enumerate every geometrically plausible incoming/outgoing pair at a node.

        Does not persist anything; callers may adjust `allowed`/`restriction_kind`
        (e.g. from a source turn-restriction relation) before calling
        `persist_candidates`.
        """
        incoming_segments = self.session.execute(
            select(RoadSegmentModel).where(RoadSegmentModel.to_node_id == intersection_node_id)
        ).scalars().all()
        outgoing_segments = self.session.execute(
            select(RoadSegmentModel).where(RoadSegmentModel.from_node_id == intersection_node_id)
        ).scalars().all()

        candidates = []
        for incoming in incoming_segments:
            incoming_line = geom_to_linestring(incoming.geom)
            incoming_bearing = bearing_degrees(incoming_line[-2], incoming_line[-1])

            for outgoing in outgoing_segments:
                outgoing_line = geom_to_linestring(outgoing.geom)
                outgoing_bearing = bearing_degrees(outgoing_line[0], outgoing_line[1])

                candidates.append(
                    TurnMovement(
                        id=None,
                        intersection_node_id=intersection_node_id,
                        incoming_segment_id=incoming.id,
                        outgoing_segment_id=outgoing.id,
                        movement_kind=classify_turn(incoming_bearing, outgoing_bearing),
                        allowed=True,
                        restriction_kind=RestrictionKind.NONE,
                    )
                )

        return candidates

    def persist_candidates(self, movements: list[TurnMovement]) -> list[TurnMovement]:
        persisted_models = []
        for movement in movements:
            model = self.session.execute(
                select(TurnMovementModel).where(
                    TurnMovementModel.incoming_segment_id == movement.incoming_segment_id,
                    TurnMovementModel.outgoing_segment_id == movement.outgoing_segment_id,
                )
            ).scalar_one_or_none()

            if model is None:
                model = TurnMovementModel(
                    intersection_node_id=movement.intersection_node_id,
                    incoming_segment_id=movement.incoming_segment_id,
                    outgoing_segment_id=movement.outgoing_segment_id,
                    movement_kind=movement.movement_kind,
                    allowed=movement.allowed,
                    restriction_kind=movement.restriction_kind,
                )
                self.session.add(model)
            else:
                model.intersection_node_id = movement.intersection_node_id
                model.movement_kind = movement.movement_kind
                model.allowed = movement.allowed
                model.restriction_kind = movement.restriction_kind

            persisted_models.append(model)

        self.session.flush()
        return [self._to_domain(model) for model in persisted_models]

    def legal_outgoing_segments(self, incoming_segment_id) -> list[TurnMovement]:
        models = self.session.execute(
            select(TurnMovementModel).where(
                TurnMovementModel.incoming_segment_id == incoming_segment_id,
                TurnMovementModel.allowed.is_(True),
            )
        ).scalars().all()
        return [self._to_domain(model) for model in models]

    @staticmethod
    def _to_domain(model: TurnMovementModel) -> TurnMovement:
        return TurnMovement(
            id=model.id,
            intersection_node_id=model.intersection_node_id,
            incoming_segment_id=model.incoming_segment_id,
            outgoing_segment_id=model.outgoing_segment_id,
            movement_kind=MovementKind(model.movement_kind),
            allowed=model.allowed,
            restriction_kind=RestrictionKind(model.restriction_kind),
        )
