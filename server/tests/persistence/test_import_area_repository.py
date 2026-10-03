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
