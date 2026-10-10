from app.domain.block import Block
from app.domain.bounding_box import BoundingBox, Coordinate
from app.persistence.repositories.block import BlockRepository
from app.persistence.repositories.import_area import ImportAreaRepository


def _square(lat, lon, size=0.0004):
    return (
        Coordinate(lat, lon),
        Coordinate(lat, lon + size),
        Coordinate(lat + size, lon + size),
        Coordinate(lat + size, lon),
        Coordinate(lat, lon),
    )


def _area(db_session, lat, lon, *, completed=True):
    repo = ImportAreaRepository(db_session)
    area = repo.get_or_create("osm", BoundingBox(Coordinate(lat, lon), Coordinate(lat + 0.02, lon + 0.02)))
    if completed:
        repo.mark_completed(area.id, road_count=0, node_count=0, building_count=0, poi_count=0, area_feature_count=0)
    return area.id


def _block(db_session, area_id, lat, lon):
    return BlockRepository(db_session).add(
        Block(id=None, import_area_id=area_id, boundary=_square(lat, lon), area_square_meters=1600.0)
    )


# At latitude 30 a thousandth of a degree of longitude is about 96 m.
ORIGIN = Coordinate(30.0002, -97.7998)


def test_blocks_within_finds_a_block_of_another_completed_area_and_ignores_one_beyond_the_radius(db_session):
    here = _area(db_session, 30.0, -97.8)
    other = _area(db_session, 30.0, -97.7)
    near = _block(db_session, other, 30.0, -97.797)  # about 290 m east
    _block(db_session, other, 30.0, -97.79)  # about 960 m east

    found = BlockRepository(db_session).blocks_within(ORIGIN, 500, exclude_area_id=here)

    assert [block.id for block, _ in found] == [near.id]
    assert 200 < found[0][1] < 400


def test_blocks_within_excludes_the_given_area_and_unfinished_areas(db_session):
    here = _area(db_session, 30.0, -97.8)
    pending = _area(db_session, 30.0, -97.7, completed=False)
    own = _block(db_session, here, 30.0, -97.7995)
    _block(db_session, pending, 30.0, -97.7995)

    repo = BlockRepository(db_session)

    assert [block.id for block, _ in repo.blocks_within(ORIGIN, 500)] == [own.id]
    assert repo.blocks_within(ORIGIN, 500, exclude_area_id=here) == []


def test_blocks_within_orders_nearest_first(db_session):
    area = _area(db_session, 30.0, -97.8)
    far = _block(db_session, area, 30.0, -97.796)
    near = _block(db_session, area, 30.0, -97.798)

    found = BlockRepository(db_session).blocks_within(ORIGIN, 500)

    assert [block.id for block, _ in found] == [near.id, far.id]
    assert found[0][1] < found[1][1]
