import copy
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import ImportStatus, RestrictionKind
from app.ingestion.osm_adapter import OSMIngestionError, PayloadOutsideBoundingBox
from app.ingestion.service import OSMIngestionService
from app.persistence.models import (
    BuildingModel,
    ImportAreaModel,
    RoadModel,
    RoadSegmentModel,
    TurnMovementModel,
)


FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"
LOOP_FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_block_loop.json"


def _bbox():
    return BoundingBox(Coordinate(9.933, -84.081), Coordinate(9.935, -84.079))


def _loop_bbox():
    return BoundingBox(Coordinate(9.9398, -84.0902), Coordinate(9.9407, -84.0893))


def test_fixture_import_persists_normalized_data_and_is_idempotent(db_session):
    payload = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)

    first = service.import_fixture(_bbox(), payload)
    second = service.import_fixture(_bbox(), payload)

    assert first.import_area.id == second.import_area.id
    assert second.import_area.status is ImportStatus.COMPLETED
    assert (second.road_count, second.building_count, second.poi_count, second.area_feature_count) == (3, 1, 1, 1)
    # osm_neighborhood.json's roads form a star from node 2, not a closed loop.
    assert (second.block_count, second.linked_building_count) == (0, 0)
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


def test_reimport_keeps_entity_ids_when_payload_is_unchanged(db_session):
    payload = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)

    service.import_fixture(_bbox(), payload)
    road_ids_before = set(db_session.scalars(select(RoadModel.id)).all())
    building_ids_before = set(db_session.scalars(select(BuildingModel.id)).all())

    service.import_fixture(_bbox(), payload)
    road_ids_after = set(db_session.scalars(select(RoadModel.id)).all())
    building_ids_after = set(db_session.scalars(select(BuildingModel.id)).all())

    assert road_ids_after == road_ids_before
    assert building_ids_after == building_ids_before


def test_reimport_with_changed_payload_removes_what_it_no_longer_produces(db_session):
    payload = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)
    service.import_fixture(_bbox(), payload)

    changed = copy.deepcopy(payload)
    changed["elements"] = [
        element for element in changed["elements"]
        if not (element["type"] == "way" and element["id"] in (200, 101))
    ]
    result = service.import_fixture(_bbox(), changed)

    assert result.building_count == 0
    assert result.road_count == 2
    assert db_session.scalar(select(func.count()).select_from(BuildingModel)) == 0
    remaining_roads = set(db_session.scalars(select(RoadModel.source_id)).all())
    assert remaining_roads == {"100", "102"}
    # 101's segments and any turn movement referencing them are gone too.
    assert db_session.scalar(
        select(func.count()).select_from(RoadSegmentModel).join(RoadModel).where(RoadModel.source_id == "101")
    ) == 0
    # Node 3 existed only as 101's endpoint, so it was swept along with the road.
    from app.persistence.models import NavigableNodeModel

    remaining_source_ids = set(db_session.scalars(select(NavigableNodeModel.source_id)).all())
    assert "3" not in remaining_source_ids


def test_first_import_reports_only_created(db_session):
    payload = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)

    result = service.import_fixture(_bbox(), payload)

    assert result.created_count > 0
    assert result.updated_count == 0
    assert result.removed_count == 0


def test_reimport_unchanged_payload_reports_only_updated(db_session):
    payload = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)
    service.import_fixture(_bbox(), payload)

    result = service.import_fixture(_bbox(), payload)

    assert result.created_count == 0
    assert result.updated_count > 0
    assert result.removed_count == 0


def test_reimport_with_changed_payload_reports_removed_matching_sweep(db_session):
    payload = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)
    service.import_fixture(_bbox(), payload)

    changed = copy.deepcopy(payload)
    changed["elements"] = [
        element for element in changed["elements"]
        if not (element["type"] == "way" and element["id"] in (200, 101))
    ]
    result = service.import_fixture(_bbox(), changed)

    assert result.removed_count > 0
    assert result.building_count == 0
    assert result.road_count == 2


def test_reimport_removing_a_connecting_road_breaks_a_route_that_needed_it(db_session):
    """A purpose-built, restriction-free linear fixture: A-B-C-D. Removing the
    middle way (B-C) after an import must disconnect A from D, not just shrink
    counts — the RoutingEngine, not just the row counts, has to see the split.
    """

    def linear_payload(include_middle: bool) -> dict:
        elements = [
            {"type": "node", "id": 1, "lat": 10.0000, "lon": -80.0000},
            {"type": "node", "id": 2, "lat": 10.0000, "lon": -79.9990},
            {"type": "node", "id": 3, "lat": 10.0000, "lon": -79.9970},
            {"type": "node", "id": 4, "lat": 10.0000, "lon": -79.9960},
            {"type": "way", "id": 1001, "nodes": [1, 2], "tags": {"highway": "residential"}},
            {"type": "way", "id": 1003, "nodes": [3, 4], "tags": {"highway": "residential"}},
        ]
        if include_middle:
            elements.append({"type": "way", "id": 1002, "nodes": [2, 3], "tags": {"highway": "residential"}})
        return {"elements": elements}

    bbox = BoundingBox(Coordinate(9.999, -80.001), Coordinate(10.001, -79.995))
    service = OSMIngestionService(db_session)
    first = service.import_fixture(bbox, linear_payload(include_middle=True))
    area_id = first.import_area.id

    from app.routing.engine import NoRouteFoundError, RoutingEngine

    connected_route = RoutingEngine(db_session).plan_route(area_id, Coordinate(10.0, -80.0000), Coordinate(10.0, -79.9960))
    assert connected_route.total_distance_meters > 0

    service.import_fixture(bbox, linear_payload(include_middle=False))

    with pytest.raises(NoRouteFoundError):
        RoutingEngine(db_session).plan_route(area_id, Coordinate(10.0, -80.0000), Coordinate(10.0, -79.9960))


def test_reimport_with_restriction_removed_reverts_the_movement_to_allowed(db_session):
    payload = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)
    service.import_fixture(_bbox(), payload)

    changed = copy.deepcopy(payload)
    changed["elements"] = [element for element in changed["elements"] if element.get("type") != "relation"]
    service.import_fixture(_bbox(), changed)

    prohibited = db_session.scalar(
        select(TurnMovementModel).where(TurnMovementModel.restriction_kind == RestrictionKind.NO_LEFT_TURN)
    )
    assert prohibited is None
    still_allowed = db_session.scalars(select(TurnMovementModel)).all()
    assert all(movement.allowed for movement in still_allowed)


def test_failed_reimport_leaves_previous_data_intact(db_session):
    payload = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)
    first = service.import_fixture(_bbox(), payload)

    broken = copy.deepcopy(payload)
    broken["elements"].append(
        {"type": "way", "id": 999, "nodes": [1, 12345], "tags": {"highway": "residential"}}
    )

    with pytest.raises(OSMIngestionError):
        service.import_fixture(_bbox(), broken)

    assert db_session.scalar(select(ImportAreaModel.status)) == ImportStatus.FAILED
    assert db_session.scalar(select(func.count()).select_from(BuildingModel)) == first.building_count
    assert db_session.scalar(select(func.count()).select_from(RoadModel)) == first.road_count


def test_payload_outside_bounding_box_fails_the_import(db_session):
    payload = json.loads(FIXTURE.read_text())
    payload["elements"].append(
        {"type": "node", "id": 9001, "lat": 40.0, "lon": -3.0, "tags": {"amenity": "school", "name": "Far School"}}
    )

    with pytest.raises(PayloadOutsideBoundingBox) as excinfo:
        OSMIngestionService(db_session).import_fixture(_bbox(), payload)

    assert "9001" in str(excinfo.value)
    assert db_session.scalar(select(ImportAreaModel.status)) == ImportStatus.FAILED


def test_road_crossing_the_bounding_box_edge_is_accepted(db_session):
    payload = json.loads(FIXTURE.read_text())
    # Node 3 sits just outside the bbox used by _bbox(); way 101 (2 -> 3) crosses the edge.
    tight_bbox = BoundingBox(Coordinate(9.933, -84.0802), Coordinate(9.935, -84.0797))

    result = OSMIngestionService(db_session).import_fixture(tight_bbox, payload)

    assert result.import_area.status is ImportStatus.COMPLETED


def test_import_of_closed_loop_derives_one_block_and_links_the_building(db_session):
    payload = json.loads(LOOP_FIXTURE.read_text())

    result = OSMIngestionService(db_session).import_fixture(_loop_bbox(), payload)

    assert result.block_count == 1
    assert result.linked_building_count == 1
    building_block_id = db_session.scalar(select(BuildingModel.block_id))
    assert building_block_id is not None


def test_reimport_missing_a_loop_road_removes_the_block_and_unlinks_the_building(db_session):
    payload = json.loads(LOOP_FIXTURE.read_text())
    service = OSMIngestionService(db_session)
    service.import_fixture(_loop_bbox(), payload)

    broken_loop = copy.deepcopy(payload)
    broken_loop["elements"] = [
        element for element in broken_loop["elements"] if not (element["type"] == "way" and element["id"] == 12)
    ]
    result = service.import_fixture(_loop_bbox(), broken_loop)

    assert result.block_count == 0
    assert db_session.scalar(select(BuildingModel.block_id)) is None


def test_derivation_failure_during_import_marks_the_area_failed_with_no_partial_blocks(db_session, monkeypatch):
    from app.persistence.block_derivation import BlockDerivationService

    def _boom(self, import_area_id):
        raise RuntimeError("simulated derivation failure")

    monkeypatch.setattr(BlockDerivationService, "derive_for_import_area", _boom)

    payload = json.loads(LOOP_FIXTURE.read_text())
    with pytest.raises(OSMIngestionError):
        OSMIngestionService(db_session).import_fixture(_loop_bbox(), payload)

    assert db_session.scalar(select(ImportAreaModel.status)) == ImportStatus.FAILED
    assert db_session.scalar(select(func.count()).select_from(BuildingModel).where(BuildingModel.block_id.isnot(None))) == 0


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
