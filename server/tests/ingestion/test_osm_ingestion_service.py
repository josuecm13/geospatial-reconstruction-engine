import copy
import json
from contextlib import contextmanager
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import ImportStatus, RestrictionKind, RoadClassification
from app.domain.street_grouping import street_id_for
from app.ingestion.osm_adapter import OSMIngestionError, PayloadOutsideBoundingBox
from app.ingestion.overpass import IncompleteSourceResponse
from app.ingestion.service import OSMIngestionService
from app.persistence.models import (
    BuildingModel,
    ImportAreaModel,
    RoadModel,
    RoadSegmentModel,
    StreetModel,
    TurnMovementModel,
)


FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json"
LOOP_FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_block_loop.json"


def _bbox():
    return BoundingBox(Coordinate(9.933, -84.081), Coordinate(9.935, -84.079))


def _loop_bbox():
    return BoundingBox(Coordinate(9.9398, -84.0902), Coordinate(9.9407, -84.0893))


def test_import_reports_each_step_to_the_step_timer(db_session):
    steps = []

    @contextmanager
    def step_timer(step):
        steps.append(step)
        yield

    OSMIngestionService(db_session, step_timer=step_timer).import_fixture(_bbox(), json.loads(FIXTURE.read_text()))

    assert steps == ["parse", "persist features", "sweep", "turns", "block derivation", "link buildings"]


def test_import_logs_how_long_each_step_took_and_a_summary(db_session, caplog):
    with caplog.at_level("INFO", logger="app.ingestion.service"):
        OSMIngestionService(db_session).import_fixture(_bbox(), json.loads(FIXTURE.read_text()))

    for step in ("parse", "persist features", "sweep", "turns", "block derivation", "link buildings"):
        assert f"{step} took" in caplog.text
    assert "persisted in" in caplog.text
    assert "3 roads, 1 buildings" in caplog.text


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


GROUPED_FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_grouped_streets.json"


def _grouped_bbox():
    return BoundingBox(Coordinate(9.9488, -84.1002), Coordinate(9.9513, -84.0983))


def test_ways_are_grouped_into_logical_streets_with_ids_stable_across_reimport(db_session):
    payload = json.loads(GROUPED_FIXTURE.read_text())
    service = OSMIngestionService(db_session)

    area_id = service.import_fixture(_grouped_bbox(), payload).import_area.id
    street_by_road = dict(db_session.execute(select(RoadModel.source_id, RoadModel.street_id)).all())
    streets_before = {street.id: street for street in db_session.scalars(select(StreetModel)).all()}

    # Main Street (three connected ways, names differing in case and spacing),
    # Central Avenue (a divided road's two one-way carriageways), and two
    # connected unnamed ways that stay separate.
    assert len(streets_before) == 4
    assert street_by_road["100"] == street_by_road["101"] == street_by_road["102"]
    assert street_by_road["200"] == street_by_road["201"]
    assert street_by_road["300"] != street_by_road["301"]
    main = streets_before[street_by_road["100"]]
    assert (main.name, main.classification) == ("Main Street", RoadClassification.TERTIARY)
    # Deterministic, not just stable: derived from the area and the grouped ways.
    assert main.id == street_id_for(area_id, "100+101+102")

    service.import_fixture(_grouped_bbox(), payload)

    assert set(db_session.scalars(select(StreetModel.id)).all()) == set(streets_before)
    assert dict(db_session.execute(select(RoadModel.source_id, RoadModel.street_id)).all()) == street_by_road


def _with_extra_buildings(payload, extra_tags):
    """Adds one building per tag set, reusing fixture building 200's footprint nodes."""
    changed = copy.deepcopy(payload)
    for offset, tags in enumerate(extra_tags, start=1):
        changed["elements"].append({"type": "way", "id": 900 + offset, "nodes": [11, 12, 13, 14, 11], "tags": tags})
    return changed


def test_import_records_source_height_and_levels_and_keeps_unknown_null(db_session):
    payload = _with_extra_buildings(
        json.loads(FIXTURE.read_text()),
        [
            {"building": "yes", "height": "12 m"},
            {"building": "yes", "building:levels": "3"},
            {"building": "yes", "height": "tall", "building:levels": "2.5"},
        ],
    )

    result = OSMIngestionService(db_session).import_fixture(_bbox(), payload)

    assert result.import_area.status is ImportStatus.COMPLETED
    stored = {
        model.source_id: (model.height_meters, model.levels)
        for model in db_session.scalars(select(BuildingModel)).all()
    }
    assert stored == {"200": (None, None), "901": (12.0, None), "902": (None, 3), "903": (None, None)}


def test_reimport_updates_a_changed_height_in_place(db_session):
    fixture = json.loads(FIXTURE.read_text())
    service = OSMIngestionService(db_session)
    service.import_fixture(_bbox(), _with_extra_buildings(fixture, [{"building": "yes", "height": "12", "building:levels": "4"}]))
    before = db_session.scalar(select(BuildingModel).where(BuildingModel.source_id == "901"))
    building_id = before.id

    service.import_fixture(_bbox(), _with_extra_buildings(fixture, [{"building": "yes", "height": "15"}]))
    db_session.expire_all()
    after = db_session.scalar(select(BuildingModel).where(BuildingModel.source_id == "901"))

    assert after.id == building_id
    assert (after.height_meters, after.levels) == (15.0, None)


TIMEOUT_FIXTURE = Path(__file__).parents[1] / "fixtures" / "overpass" / "timeout_remark.json"


def _stored_snapshot(db_session):
    area = db_session.scalar(select(ImportAreaModel))
    return (
        area.id,
        area.status,
        (area.road_count, area.node_count, area.building_count, area.poi_count, area.area_feature_count),
        set(db_session.scalars(select(RoadModel.id)).all()),
        set(db_session.scalars(select(BuildingModel.id)).all()),
    )


def test_timed_out_response_leaves_an_imported_area_untouched(db_session):
    service = OSMIngestionService(db_session)
    service.import_fixture(_bbox(), json.loads(FIXTURE.read_text()))
    before = _stored_snapshot(db_session)

    with pytest.raises(IncompleteSourceResponse, match="timed out"):
        service.import_fixture(_bbox(), json.loads(TIMEOUT_FIXTURE.read_text()))

    db_session.expire_all()
    assert _stored_snapshot(db_session) == before
    assert before[1] == ImportStatus.COMPLETED.value


def test_remark_on_a_first_import_creates_no_area(db_session):
    payload = {**json.loads(FIXTURE.read_text()), "remark": "runtime error: Query run out of memory using about 2048 MB of RAM."}

    with pytest.raises(IncompleteSourceResponse):
        OSMIngestionService(db_session).import_fixture(_bbox(), payload)

    assert db_session.scalar(select(func.count()).select_from(ImportAreaModel)) == 0


LIVE_FIXTURE = Path(__file__).parents[1] / "fixtures" / "overpass" / "rosenthaler_platz_small.json"
LIVE_BBOX = BoundingBox(Coordinate(52.5292, 13.4005), Coordinate(52.5302, 13.4021))


def test_recorded_live_response_imports(db_session):
    payload = json.loads(LIVE_FIXTURE.read_text())

    result = OSMIngestionService(db_session).import_fixture(LIVE_BBOX, payload)

    assert result.import_area.status is ImportStatus.COMPLETED
    assert result.road_count > 0 and result.building_count > 0 and result.block_count > 0


def test_roundabout_imports_one_way_in_its_drawn_direction(db_session):
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.9340, "lon": -84.0800},
            {"type": "node", "id": 2, "lat": 9.9341, "lon": -84.0799},
            {"type": "node", "id": 3, "lat": 9.9340, "lon": -84.0798},
            {"type": "way", "id": 10, "nodes": [1, 2, 3], "tags": {"highway": "tertiary", "junction": "roundabout"}},
        ]
    }

    OSMIngestionService(db_session).import_fixture(_bbox(), payload)

    from app.persistence.models import NavigableNodeModel

    segments = db_session.scalars(select(RoadSegmentModel)).all()
    source_ids = {node.id: node.source_id for node in db_session.scalars(select(NavigableNodeModel)).all()}
    assert [(source_ids[s.from_node_id], source_ids[s.to_node_id]) for s in segments] == [("1", "3")]


def test_reversible_way_imports_with_both_directions(db_session):
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lat": 9.9340, "lon": -84.0800},
            {"type": "node", "id": 2, "lat": 9.9340, "lon": -84.0798},
            {"type": "way", "id": 10, "nodes": [1, 2], "tags": {"highway": "primary", "oneway": "reversible"}},
        ]
    }

    result = OSMIngestionService(db_session).import_fixture(_bbox(), payload)

    assert result.import_area.status is ImportStatus.COMPLETED
    assert db_session.scalar(select(func.count()).select_from(RoadSegmentModel)) == 2


def _with_restriction_tags(tags):
    payload = json.loads(FIXTURE.read_text())
    for element in payload["elements"]:
        if element["type"] == "relation" and element["id"] == 400:
            element["tags"] = {"type": "restriction", **tags}
    return payload


def _prohibited_movements(db_session):
    return db_session.scalar(
        select(func.count()).select_from(TurnMovementModel).where(TurnMovementModel.restriction_kind == RestrictionKind.NO_LEFT_TURN)
    )


def test_bus_only_restriction_is_skipped_and_the_import_completes(db_session):
    result = OSMIngestionService(db_session).import_fixture(_bbox(), _with_restriction_tags({"restriction:bus": "no_left_turn"}))

    assert result.import_area.status is ImportStatus.COMPLETED
    assert _prohibited_movements(db_session) == 0


@pytest.mark.parametrize("key", ["restriction:motorcar", "restriction:motor_vehicle", "restriction:vehicle"])
def test_car_scoped_restriction_is_honored(db_session, key):
    OSMIngestionService(db_session).import_fixture(_bbox(), _with_restriction_tags({key: "no_left_turn"}))

    assert _prohibited_movements(db_session) == 1


def test_multipolygon_building_imports_and_keeps_its_id_on_reimport(db_session):
    payload = json.loads(FIXTURE.read_text())
    ring = [{"lat": 9.9340, "lon": -84.0800}, {"lat": 9.9340, "lon": -84.0795}, {"lat": 9.9345, "lon": -84.0795}, {"lat": 9.9340, "lon": -84.0800}]
    payload["elements"].append(
        {"type": "relation", "id": 900, "members": [{"type": "way", "ref": 1, "role": "outer", "geometry": ring}],
         "tags": {"type": "multipolygon", "building": "yes", "building:levels": "5"}}
    )
    service = OSMIngestionService(db_session)

    first = service.import_fixture(_bbox(), payload)
    building = db_session.scalar(select(BuildingModel).where(BuildingModel.source_id == "relation/900"))
    service.import_fixture(_bbox(), payload)
    db_session.expire_all()

    assert first.building_count == 2
    assert building.levels == 5
    assert db_session.scalar(select(BuildingModel.id).where(BuildingModel.source_id == "relation/900")) == building.id


def _poi_area_payload(lat_offset):
    """A parking area around (9.9350 + offset, -84.0800), crossing the box's north edge at 9.935."""
    base = 9.9350 + lat_offset
    return {
        "elements": [
            {"type": "node", "id": 1, "lat": base - 0.0002, "lon": -84.0801},
            {"type": "node", "id": 2, "lat": base - 0.0002, "lon": -84.0799},
            {"type": "node", "id": 3, "lat": base + 0.0006, "lon": -84.0799},
            {"type": "node", "id": 4, "lat": base + 0.0006, "lon": -84.0801},
            {"type": "way", "id": 10, "nodes": [1, 2, 3, 4, 1], "tags": {"amenity": "parking"}},
        ]
    }


def test_poi_area_crossing_the_edge_imports_even_with_its_center_outside(db_session):
    result = OSMIngestionService(db_session).import_fixture(_bbox(), _poi_area_payload(0.0))

    assert result.poi_count == 1


def test_poi_area_entirely_outside_the_box_is_still_rejected(db_session):
    with pytest.raises(PayloadOutsideBoundingBox) as error:
        OSMIngestionService(db_session).import_fixture(_bbox(), _poi_area_payload(0.001))

    assert error.value.source_ids == ["10"]
    assert error.value.source_refs == ["way/10"]


def test_poi_node_outside_the_box_is_still_rejected(db_session):
    payload = {"elements": [{"type": "node", "id": 1, "lat": 9.9351, "lon": -84.0800, "tags": {"amenity": "cafe"}}]}

    with pytest.raises(PayloadOutsideBoundingBox):
        OSMIngestionService(db_session).import_fixture(_bbox(), payload)


def _with_extra_restriction(members, tags):
    payload = json.loads(FIXTURE.read_text())
    payload["elements"].append({"type": "relation", "id": 401, "members": members, "tags": {"type": "restriction", **tags}})
    return payload


def test_restriction_missing_its_to_way_is_skipped_and_the_valid_one_still_enforced(db_session, caplog):
    payload = _with_extra_restriction(
        [{"type": "way", "ref": 100, "role": "from"}, {"type": "node", "ref": 2, "role": "via"}], {"restriction": "no_right_turn"}
    )

    with caplog.at_level("WARNING", logger="app.ingestion.service"):
        result = OSMIngestionService(db_session).import_fixture(_bbox(), payload)

    assert result.import_area.status is ImportStatus.COMPLETED
    assert result.skipped_restriction_count == 1
    assert _prohibited_movements(db_session) == 1
    assert "401" in caplog.text


def test_restriction_that_does_not_resolve_to_one_turn_is_skipped(db_session):
    # Way 101 runs 2 → 3, so it never arrives at node 1: no incoming segment to restrict.
    payload = _with_extra_restriction(
        [{"type": "way", "ref": 101, "role": "from"}, {"type": "node", "ref": 1, "role": "via"}, {"type": "way", "ref": 100, "role": "to"}],
        {"restriction": "no_u_turn"},
    )

    result = OSMIngestionService(db_session).import_fixture(_bbox(), payload)

    assert result.import_area.status is ImportStatus.COMPLETED
    assert result.skipped_restriction_count == 1
    assert _prohibited_movements(db_session) == 1


def test_two_restrictions_at_the_same_via_node_both_hold(db_session):
    # The fixture's own no_left_turn (100 -> 102) is at node 2; a second one, 101 -> 100, is too.
    payload = _with_extra_restriction(
        [{"type": "way", "ref": 101, "role": "from"}, {"type": "node", "ref": 2, "role": "via"}, {"type": "way", "ref": 100, "role": "to"}],
        {"restriction": "no_right_turn"},
    )

    result = OSMIngestionService(db_session).import_fixture(_bbox(), payload)

    assert result.skipped_restriction_count == 0
    prohibited = db_session.execute(
        select(TurnMovementModel.restriction_kind, TurnMovementModel.allowed).where(
            TurnMovementModel.restriction_kind != RestrictionKind.NONE
        )
    ).all()
    assert sorted((RestrictionKind(kind).value, allowed) for kind, allowed in prohibited) == [
        (RestrictionKind.NO_LEFT_TURN.value, False),
        (RestrictionKind.NO_RIGHT_TURN.value, False),
    ]


def test_an_import_with_only_valid_restrictions_skips_none(db_session):
    result = OSMIngestionService(db_session).import_fixture(_bbox(), json.loads(FIXTURE.read_text()))

    assert result.skipped_restriction_count == 0
