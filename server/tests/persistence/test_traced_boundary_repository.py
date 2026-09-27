import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.traced_boundary import InvalidTracedBoundary
from app.ingestion.service import OSMIngestionService
from app.persistence.geometry import polygon_to_geom
from app.persistence.models import (
    AreaFeatureModel,
    BlockModel,
    BuildingModel,
    NavigableNodeModel,
    PointOfInterestModel,
    RoadModel,
    RoadSegmentModel,
    TracedBoundaryModel,
    TurnMovementModel,
)
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.traced_boundary import (
    DuplicateTracedBoundaryName,
    TracedBoundaryRepository,
)

LOOP_FIXTURE = Path(__file__).parents[1] / "fixtures" / "osm_block_loop.json"
LOOP_BBOX = BoundingBox(Coordinate(9.9398, -84.0902), Coordinate(9.9407, -84.0893))
BBOX = BoundingBox(min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.004, -97.796))


def ring(*lat_lon: tuple[float, float]):
    return tuple(Coordinate(lat, lon) for lat, lon in lat_lon)


TRIANGLE = ring((30.001, -97.799), (30.001, -97.797), (30.003, -97.798), (30.001, -97.799))
BOW_TIE = ring((30.001, -97.799), (30.003, -97.797), (30.003, -97.799), (30.001, -97.797), (30.001, -97.799))
OUTSIDE = ring((30.001, -97.799), (30.001, -97.797), (30.005, -97.798), (30.001, -97.799))
WHOLE_BBOX = ring((30.0, -97.8), (30.0, -97.796), (30.004, -97.796), (30.004, -97.8), (30.0, -97.8))


def _area(db_session, bbox: BoundingBox = BBOX):
    return ImportAreaRepository(db_session).get_or_create("osm", bbox)


def test_creates_fetches_lists_and_deletes(db_session):
    area = _area(db_session)
    repo = TracedBoundaryRepository(db_session)

    first = repo.create(area, "  North ", TRIANGLE)
    second = repo.create(area, "Whole", WHOLE_BBOX)

    assert first.id is not None
    assert first.name == "North"
    assert first.import_area_id == area.id
    assert repo.get(first.id) == first
    assert repo.get(first.id).polygon == TRIANGLE
    assert [boundary.name for boundary in repo.list_for_import_area(area.id)] == ["North", "Whole"]
    assert ImportAreaRepository(db_session).get(area.id).bbox == BBOX

    assert repo.delete(first.id) is True
    assert repo.get(first.id) is None
    assert repo.delete(first.id) is False
    assert repo.list_for_import_area(area.id) == [second]


def test_get_returns_none_for_unknown_id(db_session):
    assert TracedBoundaryRepository(db_session).get(uuid.uuid4()) is None


def test_duplicate_name_in_the_same_area_is_rejected(db_session):
    area = _area(db_session)
    repo = TracedBoundaryRepository(db_session)
    original = repo.create(area, "North", TRIANGLE)

    with pytest.raises(DuplicateTracedBoundaryName):
        repo.create(area, "North", WHOLE_BBOX)

    # The failed insert rolled back only its own savepoint.
    assert repo.list_for_import_area(area.id) == [original]


def test_same_name_is_allowed_in_another_area(db_session):
    other_bbox = BoundingBox(min_corner=Coordinate(31.0, -97.8), max_corner=Coordinate(31.004, -97.796))
    other_triangle = tuple(Coordinate(p.latitude + 1.0, p.longitude) for p in TRIANGLE)
    repo = TracedBoundaryRepository(db_session)

    repo.create(_area(db_session), "North", TRIANGLE)
    repo.create(_area(db_session, other_bbox), "North", other_triangle)


@pytest.mark.parametrize(
    ("polygon", "rule"),
    [(BOW_TIE, "self_intersecting"), (OUTSIDE, "outside_import_area")],
    ids=["self-intersecting", "outside-bbox"],
)
def test_create_rejects_invalid_polygons_naming_the_rule(db_session, polygon, rule):
    area = _area(db_session)
    repo = TracedBoundaryRepository(db_session)

    with pytest.raises(InvalidTracedBoundary) as excinfo:
        repo.create(area, "Bad", polygon)

    assert excinfo.value.rule == rule
    assert repo.list_for_import_area(area.id) == []


@pytest.mark.parametrize("polygon", [BOW_TIE, OUTSIDE], ids=["self-intersecting", "outside-bbox"])
def test_database_rejects_invalid_polygons_inserted_directly(db_session, polygon):
    area = _area(db_session)

    with pytest.raises(IntegrityError):
        with db_session.begin_nested():
            db_session.add(TracedBoundaryModel(import_area_id=area.id, name="Bad", geom=polygon_to_geom(polygon)))
            db_session.flush()


def test_database_accepts_a_boundary_equal_to_the_bbox(db_session):
    area = _area(db_session)
    db_session.add(TracedBoundaryModel(import_area_id=area.id, name="Whole", geom=polygon_to_geom(WHOLE_BBOX)))
    db_session.flush()


def _snapshot(db_session, import_area_id):
    def count(model, *where):
        return db_session.scalar(select(func.count()).select_from(model).where(*where))

    return {
        "roads": count(RoadModel, RoadModel.import_area_id == import_area_id),
        "segments": count(
            RoadSegmentModel,
            RoadSegmentModel.road_id.in_(select(RoadModel.id).where(RoadModel.import_area_id == import_area_id)),
        ),
        "turns": count(TurnMovementModel),
        "nodes": count(NavigableNodeModel, NavigableNodeModel.import_area_id == import_area_id),
        "buildings": count(BuildingModel, BuildingModel.import_area_id == import_area_id),
        "pois": count(PointOfInterestModel, PointOfInterestModel.import_area_id == import_area_id),
        "area_features": count(AreaFeatureModel, AreaFeatureModel.import_area_id == import_area_id),
        "block_ids": set(
            db_session.scalars(select(BlockModel.id).where(BlockModel.import_area_id == import_area_id)).all()
        ),
        "area": ImportAreaRepository(db_session).get(import_area_id),
    }


def _loop_boundary():
    # A quarter of the loop fixture's bbox, in its south-west corner.
    lat0, lon0 = LOOP_BBOX.min_corner.latitude, LOOP_BBOX.min_corner.longitude
    lat1, lon1 = lat0 + 0.00045, lon0 + 0.00045
    return ring((lat0, lon0), (lat0, lon1), (lat1, lon1), (lat1, lon0), (lat0, lon0))


def test_creating_and_deleting_a_boundary_leaves_imported_data_unchanged(db_session):
    area = OSMIngestionService(db_session).import_fixture(LOOP_BBOX, json.loads(LOOP_FIXTURE.read_text())).import_area
    before = _snapshot(db_session, area.id)
    assert before["block_ids"], "the loop fixture must derive at least one block for this test to mean anything"

    repo = TracedBoundaryRepository(db_session)
    boundary = repo.create(area, "South-west", _loop_boundary())
    after_create = _snapshot(db_session, area.id)
    repo.delete(boundary.id)
    after_delete = _snapshot(db_session, area.id)

    assert before == after_create == after_delete


def test_re_import_keeps_boundaries(db_session):
    payload = json.loads(LOOP_FIXTURE.read_text())
    service = OSMIngestionService(db_session)
    area = service.import_fixture(LOOP_BBOX, payload).import_area
    boundary = TracedBoundaryRepository(db_session).create(area, "South-west", _loop_boundary())

    service.import_fixture(LOOP_BBOX, payload)

    assert TracedBoundaryRepository(db_session).list_for_import_area(area.id) == [boundary]
