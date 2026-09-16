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
