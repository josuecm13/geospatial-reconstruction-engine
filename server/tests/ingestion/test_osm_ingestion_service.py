import json
from pathlib import Path

from sqlalchemy import func, select

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import ImportStatus, RestrictionKind
from app.ingestion.service import OSMIngestionService
from app.persistence.models import ImportAreaModel, RoadModel, RoadSegmentModel, TurnMovementModel


FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"


def _bbox():
    return BoundingBox(Coordinate(9.933, -84.081), Coordinate(9.935, -84.079))


def test_fixture_import_persists_normalized_data_and_is_idempotent(db_session):
    payload = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)

    first = service.import_fixture(_bbox(), payload)
    second = service.import_fixture(_bbox(), payload)

    assert first.import_area.id == second.import_area.id
    assert second.import_area.status is ImportStatus.COMPLETED
    assert (second.road_count, second.building_count, second.poi_count, second.area_feature_count) == (3, 1, 1, 1)
    assert db_session.scalar(select(func.count()).select_from(RoadSegmentModel)) == 5
    assert db_session.scalar(select(func.count()).select_from(TurnMovementModel)) > 0
    assert set(db_session.scalars(select(RoadSegmentModel.lane_count)).all()) >= {1, 2, None}
    one_way_segments = db_session.scalars(
        select(RoadSegmentModel).join(RoadModel).where(RoadModel.source_id == "102")
    ).all()
    assert len(one_way_segments) == 1
    prohibited = db_session.scalar(select(TurnMovementModel).where(TurnMovementModel.restriction_kind == RestrictionKind.NO_LEFT_TURN))
    assert prohibited is not None
    assert prohibited.allowed is False


def test_malformed_import_marks_the_import_area_failed(db_session):
    payload = {"elements": [{"type": "way", "id": 1, "nodes": [10, 20], "tags": {"highway": "residential"}}]}

    try:
        OSMIngestionService(db_session).import_fixture(_bbox(), payload)
    except Exception:
        pass

    status = db_session.scalar(select(ImportAreaModel.status))
    assert status == ImportStatus.FAILED


def test_only_turn_restriction_keeps_target_and_prohibits_competing_turns(db_session):
    payload = json.loads(FIXTURE.read_text())
    payload["elements"][-1]["tags"]["restriction"] = "only_left_turn"

    OSMIngestionService(db_session).import_fixture(_bbox(), payload)

    only_turns = db_session.scalars(
        select(TurnMovementModel).where(TurnMovementModel.restriction_kind == RestrictionKind.ONLY_LEFT_TURN)
    ).all()
    assert len(only_turns) == 3
    assert sum(movement.allowed for movement in only_turns) == 1
