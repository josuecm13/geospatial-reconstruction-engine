"""Generation and block feedback over HTTP (Milestone 11, #23). Blocks are inserted with the shape the
test wants, in the metres of the area's local projection, on top of an imported fixture area."""

import json
import uuid

import pytest
from sqlalchemy import delete

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.local_projection import local_projection_for
from app.generation.geometry import from_local_xy
from app.generation.run import GenerationService
from app.persistence.geometry import multipolygon_to_geom, polygon_to_geom
from app.persistence.models import BlockModel
from app.persistence.repositories.import_area import ImportAreaRepository
from tests.api.test_background_import import (
    BBOX,
    InlineExecutor,
    NeverRunsExecutor,
    _events,
    _payload,
    _use_registry,
)

RUN_KEYS = {
    "run_id",
    "seed",
    "algorithm_version",
    "created_at",
    "building_count",
    "block_count",
    "eligible_block_count",
    "stale",
    "stale_reasons",
    "feedback_shortfall_block_ids",
    "calibration_ratio",
}


def insert_block(db_session, area_id, x0=0, y0=0, x1=90, y1=80, inset=3.0, **flags):
    """A block whose boundary is the rectangle (metres from the area's centre), buildable area inset."""
    area = ImportAreaRepository(db_session).get(uuid.UUID(area_id))
    projection = local_projection_for(area.bbox.ring())

    def ring(a, b, c, d):
        return tuple(from_local_xy(projection, x, y) for x, y in [(a, b), (c, b), (c, d), (a, d), (a, b)])

    model = BlockModel(
        import_area_id=area.id,
        boundary=polygon_to_geom(ring(x0, y0, x1, y1)),
        area_square_meters=(x1 - x0) * (y1 - y0),
        buildable_area=multipolygon_to_geom((ring(x0 + inset, y0 + inset, x1 - inset, y1 - inset),)),
        buildable_area_square_meters=(x1 - x0 - 2 * inset) * (y1 - y0 - 2 * inset),
        **flags,
    )
    db_session.add(model)
    db_session.commit()
    return str(model.id)


@pytest.fixture()
def inline(client, db_session):
    return _use_registry(client, db_session, InlineExecutor())


@pytest.fixture()
def area(client, db_session, inline):
    response = client.post("/import-areas", json={"bbox": BBOX, "payload": _payload()})
    assert response.status_code == 200, response.text
    return response.json()["id"]


@pytest.fixture()
def block_id(db_session, area):
    return insert_block(db_session, area)


def generate(client, area_id, **body):
    return client.post(f"/import-areas/{area_id}/generation", json=body) if body else client.post(f"/import-areas/{area_id}/generation")


def test_generate_answers_202_then_streams_generation_and_completed(client, area, block_id):
    response = generate(client, area)

    assert response.status_code == 202
    assert response.json() == {"import_area_id": area, "events_url": f"/import-areas/{area}/events"}
    events = _events(client, area)
    assert [event["stage"] for event in events] == ["generation", "generated", "completed"]
    assert events[0]["data"] == {"block_count": 1}
    run = events[-1]["data"]["run"]
    assert set(run) == RUN_KEYS
    assert (run["seed"], run["algorithm_version"], run["stale"], run["stale_reasons"]) == (1, "frontage-lots-v1", False, [])
    assert run["building_count"] > 0 and run["block_count"] == 1 and run["eligible_block_count"] == 1
    assert run["feedback_shortfall_block_ids"] == [] and run["calibration_ratio"] is None


def test_get_returns_the_run_the_job_completed_with(client, area, block_id):
    assert client.get(f"/import-areas/{area}/generation").json()["error"]["code"] == "generation_not_found"
    generate(client, area)

    response = client.get(f"/import-areas/{area}/generation")

    assert response.status_code == 200
    assert response.json() == _events(client, area)[-1]["data"]["run"]


def test_generated_events_stream_rings_whose_buildings_are_the_ones_map_data_returns(client, db_session, area):
    insert_block(db_session, area, 300, 0, 390, 80)
    insert_block(db_session, area, 0, 0, 90, 80)

    generate(client, area)

    events = _events(client, area)
    stages = [event["stage"] for event in events]
    assert stages[0] == "generation" and stages[-1] == "completed"
    assert set(stages[1:-1]) == {"generated"} and len(stages) > 2
    streamed = {}
    for event in events[1:-1]:
        data = event["data"]
        assert set(data) == {"projection", "ring", "blocks_done", "block_count", "buildings"}
        assert data["block_count"] == 2 and 0 < data["blocks_done"] <= 2
        assert len(data["buildings"]["features"]) <= 500
        for feature in data["buildings"]["features"]:
            streamed[feature["id"]] = feature
    assert [event["data"]["ring"] for event in events[1:-1]] == sorted(event["data"]["ring"] for event in events[1:-1])
    assert events[-2]["data"]["blocks_done"] == 2
    assert len({json.dumps(event["data"]["projection"], sort_keys=True) for event in events[1:-1]}) == 1

    stored = {f["id"]: f for f in client.get(f"/import-areas/{area}/map-data").json()["generated_buildings"]["features"]}
    assert streamed.keys() == stored.keys() and len(streamed) == events[-1]["data"]["run"]["building_count"] > 0
    assert streamed == stored
    assert set(next(iter(streamed.values()))["properties"]) >= {
        "block_id", "style", "levels", "height_meters", "base_elevation_meters",
        "reference_block_id", "count_source", "generated",
    }


def test_a_ring_of_more_than_500_buildings_is_split_across_events():
    from app.api.background_import import chunks

    assert [len(batch) for batch in chunks(list(range(1201)))] == [500, 500, 201]
    assert [len(batch) for batch in chunks(list(range(500)))] == [500]
    assert chunks([]) == [[]]


def test_the_seed_is_the_bodys_then_the_current_runs_then_one(client, area, block_id):
    generate(client, area)
    assert client.get(f"/import-areas/{area}/generation").json()["seed"] == 1

    generate(client, area, seed=42)
    assert client.get(f"/import-areas/{area}/generation").json()["seed"] == 42

    generate(client, area)
    assert client.get(f"/import-areas/{area}/generation").json()["seed"] == 42

    assert client.post(f"/import-areas/{area}/generation", json={"seed": "many"}).status_code == 422


def test_delete_removes_the_run_and_a_second_delete_is_a_404(client, area, block_id):
    generate(client, area)

    assert client.delete(f"/import-areas/{area}/generation").status_code == 204

    assert client.get(f"/import-areas/{area}/generation").status_code == 404
    again = client.delete(f"/import-areas/{area}/generation")
    assert again.status_code == 404 and again.json()["error"]["code"] == "generation_not_found"
    assert client.get(f"/import-areas/{area}/map-data").json()["generation"] is None


def test_an_unknown_area_is_a_404_on_every_generation_route(client, inline):
    missing = uuid.uuid4()

    for call in (
        client.post(f"/import-areas/{missing}/generation"),
        client.get(f"/import-areas/{missing}/generation"),
        client.delete(f"/import-areas/{missing}/generation"),
        client.get(f"/import-areas/{missing}/feedback"),
    ):
        assert call.status_code == 404 and call.json()["error"]["code"] == "import_area_not_found"


def test_an_area_that_is_not_completed_cannot_be_generated(client, db_session, inline):
    pending = ImportAreaRepository(db_session).get_or_create(
        "osm", BoundingBox(Coordinate(1.0, 1.0), Coordinate(1.001, 1.001))
    )
    db_session.commit()

    response = generate(client, str(pending.id))

    assert response.status_code == 409 and response.json()["error"]["code"] == "import_area_not_ready"


def test_a_second_generation_while_one_runs_is_a_409_and_so_is_deleting_the_run(client, db_session, area, block_id):
    _use_registry(client, db_session, NeverRunsExecutor())
    assert generate(client, area).status_code == 202

    second = generate(client, area)

    assert second.status_code == 409 and second.json()["error"]["code"] == "import_in_progress"
    assert client.delete(f"/import-areas/{area}/generation").json()["error"]["code"] == "import_in_progress"


def test_a_failed_generation_is_a_failed_event_and_keeps_the_previous_run(client, area, block_id, monkeypatch):
    generate(client, area, seed=7)

    def broken(self, area, seed, progress=None, on_ring=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(GenerationService, "generate", broken)
    generate(client, area, seed=8)

    last = _events(client, area)[-1]
    assert last["stage"] == "failed" and last["data"]["code"] == "internal_error"
    assert client.get(f"/import-areas/{area}/generation").json()["seed"] == 7


def test_feedback_is_put_listed_replaced_and_deleted(client, area, block_id):
    stored = client.put(f"/blocks/{block_id}/feedback", json={"building_count": 3})

    assert stored.status_code == 200
    body = stored.json()
    assert (body["block_id"], body["import_area_id"], body["building_count"], body["no_buildings"]) == (block_id, area, 3, False)
    assert body["updated_at"] is not None
    listed = client.get(f"/import-areas/{area}/feedback").json()["feedback"]
    assert [(entry["block_id"], entry["building_count"], entry["orphaned"]) for entry in listed] == [(block_id, 3, False)]

    replaced = client.put(f"/blocks/{block_id}/feedback", json={"no_buildings": True}).json()
    assert (replaced["building_count"], replaced["no_buildings"]) == (None, True)
    assert len(client.get(f"/import-areas/{area}/feedback").json()["feedback"]) == 1

    assert client.delete(f"/blocks/{block_id}/feedback").status_code == 204
    assert client.get(f"/import-areas/{area}/feedback").json() == {"feedback": []}
    again = client.delete(f"/blocks/{block_id}/feedback")
    assert again.status_code == 404 and again.json()["error"]["code"] == "feedback_not_found"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"building_count": 2, "no_buildings": True},
        {"no_buildings": False},
        {"building_count": -1},
        {"building_count": "two"},
        {"building_count": 1, "unknown": 1},
    ],
    ids=["neither", "both", "no_buildings false alone", "negative", "not a number", "unknown field"],
)
def test_feedback_must_be_exactly_a_count_or_no_buildings(client, area, block_id, body):
    response = client.put(f"/blocks/{block_id}/feedback", json=body)

    assert response.status_code == 422 and response.json()["error"]["code"] == "invalid_request"
    assert client.get(f"/import-areas/{area}/feedback").json() == {"feedback": []}


def test_feedback_for_a_block_that_does_not_exist_is_a_404(client, area):
    response = client.put(f"/blocks/{uuid.uuid4()}/feedback", json={"building_count": 1})

    assert response.status_code == 404 and response.json()["error"]["code"] == "block_not_found"


def test_feedback_outlives_its_block_and_is_listed_as_orphaned(client, db_session, area, block_id):
    kept = insert_block(db_session, area, x0=-100, y0=-60, x1=-20, y1=-10)
    client.put(f"/blocks/{block_id}/feedback", json={"building_count": 4})
    client.put(f"/blocks/{kept}/feedback", json={"building_count": 1})
    db_session.execute(delete(BlockModel).where(BlockModel.id == uuid.UUID(block_id)))
    db_session.commit()

    listed = {entry["block_id"]: entry["orphaned"] for entry in client.get(f"/import-areas/{area}/feedback").json()["feedback"]}

    assert listed == {block_id: True, kept: False}


def test_feedback_applies_on_the_next_generation(client, area, block_id):
    client.put(f"/blocks/{block_id}/feedback", json={"building_count": 2})

    generate(client, area)

    block = next(
        feature for feature in client.get(f"/import-areas/{area}/map-data").json()["blocks"]["features"] if feature["id"] == block_id
    )
    assert block["properties"]["generated_building_count"] == 2
    assert block["properties"]["feedback"]["building_count"] == 2
