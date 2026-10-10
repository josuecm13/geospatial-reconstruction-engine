from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.enums import ImportStatus
from app.persistence.repositories.import_area import ImportAreaRepository


def _bbox() -> BoundingBox:
    return BoundingBox(
        min_corner=Coordinate(30.0, -97.8),
        max_corner=Coordinate(30.005, -97.795),
    )


def test_creates_new_import_area(db_session):
    repo = ImportAreaRepository(db_session)

    area = repo.get_or_create("osm", _bbox())

    assert area.id is not None
    assert area.provider == "osm"
    assert area.status == ImportStatus.PENDING


def test_reuses_existing_import_area_for_same_bbox(db_session):
    repo = ImportAreaRepository(db_session)
    bbox = _bbox()

    first = repo.get_or_create("osm", bbox)
    second = repo.get_or_create("osm", bbox)

    assert first.id == second.id


def test_mark_completed_updates_status_and_counts(db_session):
    repo = ImportAreaRepository(db_session)
    area = repo.get_or_create("osm", _bbox())

    updated = repo.mark_completed(
        area.id,
        road_count=3,
        node_count=4,
        building_count=5,
        poi_count=1,
        area_feature_count=0,
    )

    assert updated.status == ImportStatus.COMPLETED
    assert updated.road_count == 3
    assert updated.node_count == 4
    assert updated.building_count == 5
    assert updated.poi_count == 1
    assert updated.area_feature_count == 0
    assert updated.imported_at is not None


def test_get_returns_the_area_or_none(db_session):
    import uuid

    repo = ImportAreaRepository(db_session)
    area = repo.get_or_create("osm", _bbox())

    assert repo.get(area.id).id == area.id
    assert repo.get(uuid.uuid4()) is None


def test_block_count_reflects_derived_blocks(db_session):
    from app.domain.road_graph import NavigableNode, Road, RoadSegment
    from app.domain.enums import RoadClassification
    from app.persistence.block_derivation import BlockDerivationService
    from app.persistence.repositories.road_graph import NavigableNodeRepository, RoadRepository, RoadSegmentRepository

    repo = ImportAreaRepository(db_session)
    area = repo.get_or_create("osm", _bbox())
    assert repo.block_count(area.id) == 0

    road = RoadRepository(db_session).upsert(
        Road(id=None, import_area_id=area.id, source_id="way/loop", classification=RoadClassification.RESIDENTIAL,
             geom=(Coordinate(30.0, -97.8), Coordinate(30.0, -97.799)))
    )
    node_repo = NavigableNodeRepository(db_session)
    sw = node_repo.upsert(NavigableNode(id=None, import_area_id=area.id, source_id="node/sw", point=Coordinate(30.0, -97.8)))
    se = node_repo.upsert(NavigableNode(id=None, import_area_id=area.id, source_id="node/se", point=Coordinate(30.0, -97.799)))
    ne = node_repo.upsert(NavigableNode(id=None, import_area_id=area.id, source_id="node/ne", point=Coordinate(30.001, -97.799)))
    nw = node_repo.upsert(NavigableNode(id=None, import_area_id=area.id, source_id="node/nw", point=Coordinate(30.001, -97.8)))
    segment_repo = RoadSegmentRepository(db_session)
    for a, b in [(sw, se), (se, ne), (ne, nw), (nw, sw)]:
        segment_repo.upsert(RoadSegment(id=None, road_id=road.id, from_node_id=a.id, to_node_id=b.id, geom=(a.point, b.point)))

    BlockDerivationService(db_session).derive_for_import_area(area.id)

    assert repo.block_count(area.id) == 1


def _completed(repo, south, west, north, east):
    area = repo.get_or_create("osm", BoundingBox(Coordinate(south, west), Coordinate(north, east)))
    return repo.mark_completed(area.id, road_count=0, node_count=0, building_count=0, poi_count=0, area_feature_count=0)


def test_completed_areas_covered_by_finds_only_completed_areas_wholly_inside(db_session):
    repo = ImportAreaRepository(db_session)
    outer_bbox = BoundingBox(Coordinate(30.0, -97.8), Coordinate(30.004, -97.796))
    outer = _completed(repo, 30.0, -97.8, 30.004, -97.796)
    inside = _completed(repo, 30.001, -97.799, 30.002, -97.798)
    on_the_edge = _completed(repo, 30.0, -97.8, 30.001, -97.799)
    _completed(repo, 30.003, -97.797, 30.005, -97.795)  # partly overlapping
    _completed(repo, 30.01, -97.79, 30.011, -97.789)  # outside
    pending = repo.get_or_create("osm", BoundingBox(Coordinate(30.002, -97.798), Coordinate(30.003, -97.797)))
    failed = repo.get_or_create("osm", BoundingBox(Coordinate(30.0025, -97.7985), Coordinate(30.0035, -97.7975)))
    repo.mark_failed(failed.id)

    covered = repo.completed_areas_covered_by(outer_bbox, exclude_id=outer.id)

    assert {area.id for area in covered} == {inside.id, on_the_edge.id}
    assert pending.id not in {area.id for area in covered}
    assert outer.id in {area.id for area in repo.completed_areas_covered_by(outer_bbox)}


def test_areas_covering_finds_completed_and_importing_areas_that_cover_the_bbox(db_session):
    repo = ImportAreaRepository(db_session)
    inner_bbox = BoundingBox(Coordinate(30.001, -97.799), Coordinate(30.002, -97.798))
    inner = _completed(repo, 30.001, -97.799, 30.002, -97.798)
    covering = _completed(repo, 30.0, -97.8, 30.004, -97.796)
    on_the_edge = _completed(repo, 30.001, -97.799, 30.003, -97.797)
    importing = repo.mark_importing(
        repo.get_or_create("osm", BoundingBox(Coordinate(30.0005, -97.7995), Coordinate(30.0025, -97.7975))).id
    )
    _completed(repo, 30.0015, -97.7985, 30.003, -97.797)  # partly overlapping
    failed = repo.get_or_create("osm", BoundingBox(Coordinate(30.0, -97.8), Coordinate(30.009, -97.791)))
    repo.mark_failed(failed.id)
    repo.get_or_create("osm", BoundingBox(Coordinate(29.999, -97.801), Coordinate(30.008, -97.792)))  # pending, covers it

    found = repo.areas_covering(inner_bbox, exclude_id=inner.id)

    assert {area.id for area in found} == {covering.id, on_the_edge.id, importing.id}
    assert inner.id in {area.id for area in repo.areas_covering(inner_bbox)}


def _row_counts(db_session) -> dict[str, int]:
    from sqlalchemy import func, select

    from app.persistence import models

    tables = [
        models.StreetModel, models.RoadModel, models.NavigableNodeModel, models.RoadSegmentModel,
        models.TurnMovementModel, models.BlockModel, models.BlockBoundarySegmentModel, models.BuildingModel,
        models.PointOfInterestModel, models.AreaFeatureModel, models.TracedBoundaryModel,
    ]
    return {table.__tablename__: db_session.scalar(select(func.count()).select_from(table)) for table in tables}


def test_delete_removes_the_area_and_everything_derived_and_keeps_other_areas(db_session):
    import json
    from pathlib import Path

    from app.ingestion.service import OSMIngestionService
    from app.persistence.repositories.traced_boundary import TracedBoundaryRepository

    payload = json.loads((Path(__file__).parents[1] / "fixtures" / "osm_block_loop.json").read_text())
    other_payload = json.loads((Path(__file__).parents[1] / "fixtures" / "osm_neighborhood.json").read_text())
    first_bbox = BoundingBox(Coordinate(9.9398, -84.0902), Coordinate(9.9407, -84.0893))
    second_bbox = BoundingBox(Coordinate(9.9330, -84.0810), Coordinate(9.9350, -84.0790))  # contains osm_neighborhood
    service = OSMIngestionService(db_session)
    survivor = service.import_fixture(second_bbox, other_payload).import_area
    kept = _row_counts(db_session)
    doomed = service.import_fixture(first_bbox, payload).import_area
    TracedBoundaryRepository(db_session).create(doomed, "Whole", first_bbox.ring())
    with_both = _row_counts(db_session)
    assert with_both["road_segments"] > kept["road_segments"] and with_both["blocks"] > kept["blocks"]
    assert with_both["traced_boundaries"] == 1

    repo = ImportAreaRepository(db_session)
    assert repo.delete(doomed.id) is True

    assert _row_counts(db_session) == kept
    assert repo.get(doomed.id) is None
    assert repo.get(survivor.id) is not None
    assert repo.delete(doomed.id) is False
