import uuid

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError

from app.domain.block import Block
from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.generation import (
    BlockFeedback,
    CountSource,
    GeneratedBuilding,
    GenerationZone,
    NewGenerationRun,
    RoadClassGroup,
    SettlementStyle,
    ZoneReason,
    default_fingerprint,
)
from app.persistence.models import (
    BlockFeedbackModel,
    BlockFingerprintModel,
    BlockModel,
    GeneratedBuildingModel,
    GenerationRunModel,
    GenerationZoneModel,
)
from app.persistence.repositories.block import BlockRepository
from app.persistence.repositories.generation import BlockFeedbackRepository, GenerationRepository
from app.persistence.repositories.import_area import ImportAreaRepository


def _square(lat, lon, size=0.0004):
    return (
        Coordinate(lat, lon),
        Coordinate(lat, lon + size),
        Coordinate(lat + size, lon + size),
        Coordinate(lat + size, lon),
        Coordinate(lat, lon),
    )


def _area(db_session, lat=30.0, lon=-97.8):
    repo = ImportAreaRepository(db_session)
    area = repo.get_or_create("osm", BoundingBox(Coordinate(lat, lon), Coordinate(lat + 0.02, lon + 0.02)))
    repo.mark_completed(area.id, road_count=0, node_count=0, building_count=0, poi_count=0, area_feature_count=0)
    return area


def _block(db_session, area_id, lat=30.001, lon=-97.799):
    return BlockRepository(db_session).add(
        Block(id=None, import_area_id=area_id, boundary=_square(lat, lon), area_square_meters=1600.0)
    )


def _building(block, inset=0.0001):
    lat, lon = block.boundary[0].latitude, block.boundary[0].longitude
    return GeneratedBuilding(
        id=None,
        run_id=None,
        block_id=block.id,
        geom=_square(lat + inset, lon + inset, 0.0001),
        height_meters=6.0,
        levels=2,
        base_elevation_meters=None,
        style=SettlementStyle.REGULAR,
        reference_block_id=None,
        count_source=CountSource.DEFAULT,
    )


def _zone(block):
    lat, lon = block.boundary[0].latitude, block.boundary[0].longitude
    return GenerationZone(id=None, run_id=None, block_id=block.id, reason=ZoneReason.WATER, geom=(_square(lat, lon, 0.0001),))


def _run(area_id, seed=1, building_count=1):
    return NewGenerationRun(
        import_area_id=area_id,
        seed=seed,
        parameters={"eligible_block_count": 1},
        elevation_version=None,
        road_graph_hash="abc",
        building_count=building_count,
        block_count=1,
    )


def _count(db_session, model):
    return db_session.scalar(select(func.count()).select_from(model))


def _generate(db_session, area, block, seed=1):
    fingerprints = {block.id: default_fingerprint(RoadClassGroup.LOCAL, SettlementStyle.REGULAR)}
    return GenerationRepository(db_session).replace(_run(area.id, seed), [_building(block)], [_zone(block)], fingerprints)


def test_a_stored_run_reads_back_with_its_buildings_zones_and_fingerprints(db_session):
    area = _area(db_session)
    block = _block(db_session, area.id)

    run = _generate(db_session, area, block, seed=7)

    repo = GenerationRepository(db_session)
    stored = repo.get_run(area.id)
    assert (stored.id, stored.seed, stored.algorithm_version) == (run.id, 7, "frontage-lots-v1")
    assert stored.eligible_block_count == 1
    buildings = repo.list_buildings([area.id])
    assert [(b.block_id, b.import_area_id, b.count_source) for b in buildings] == [(block.id, area.id, CountSource.DEFAULT)]
    assert [(z.block_id, z.reason) for z in repo.list_zones(area.id)] == [(block.id, ZoneReason.WATER)]
    assert set(repo.fingerprints(run.id)) == {block.id}
    assert repo.generated_counts(run.id) == {block.id: 1}


def test_replacing_a_run_removes_the_old_buildings_and_zones(db_session):
    area = _area(db_session)
    block = _block(db_session, area.id)
    first = _generate(db_session, area, block, seed=1)

    second = _generate(db_session, area, block, seed=2)

    assert second.id != first.id
    assert _count(db_session, GenerationRunModel) == 1
    assert _count(db_session, GeneratedBuildingModel) == 1
    assert _count(db_session, GenerationZoneModel) == 1
    assert _count(db_session, BlockFingerprintModel) == 1
    assert GenerationRepository(db_session).get_run(area.id).seed == 2


def test_deleting_the_run_removes_everything_it_produced(db_session):
    area = _area(db_session)
    _generate(db_session, area, _block(db_session, area.id))

    assert GenerationRepository(db_session).delete(area.id) is True

    assert GenerationRepository(db_session).get_run(area.id) is None
    for model in (GenerationRunModel, GeneratedBuildingModel, GenerationZoneModel, BlockFingerprintModel):
        assert _count(db_session, model) == 0
    assert GenerationRepository(db_session).delete(area.id) is False


def test_deleting_a_block_removes_its_generated_buildings_and_zones_only(db_session):
    area = _area(db_session)
    swept = _block(db_session, area.id)
    kept = _block(db_session, area.id, lat=30.005)
    GenerationRepository(db_session).replace(
        _run(area.id, building_count=2), [_building(swept), _building(kept)], [_zone(swept), _zone(kept)], {}
    )

    db_session.execute(delete(BlockModel).where(BlockModel.id == swept.id))

    assert [b.block_id for b in GenerationRepository(db_session).list_buildings([area.id])] == [kept.id]
    assert [z.block_id for z in GenerationRepository(db_session).list_zones(area.id)] == [kept.id]
    assert _count(db_session, GenerationRunModel) == 1


def test_deleting_the_area_removes_runs_and_feedback(db_session):
    area = _area(db_session)
    block = _block(db_session, area.id)
    _generate(db_session, area, block)
    BlockFeedbackRepository(db_session).put(BlockFeedback(block.id, area.id, building_count=3))

    assert ImportAreaRepository(db_session).delete(area.id) is True

    for model in (GenerationRunModel, GeneratedBuildingModel, GenerationZoneModel, BlockFingerprintModel, BlockFeedbackModel):
        assert _count(db_session, model) == 0


def test_feedback_is_put_read_replaced_and_deleted(db_session):
    area = _area(db_session)
    block = _block(db_session, area.id)
    repo = BlockFeedbackRepository(db_session)
    assert repo.get(block.id) is None

    stored = repo.put(BlockFeedback(block.id, area.id, building_count=4))
    assert (stored.building_count, stored.no_buildings) == (4, False) and stored.updated_at is not None
    replaced = repo.put(BlockFeedback(block.id, area.id, no_buildings=True))
    assert (replaced.building_count, replaced.no_buildings) == (None, True)
    assert repo.get(block.id) == replaced
    assert _count(db_session, BlockFeedbackModel) == 1

    assert repo.delete(block.id) is True
    assert repo.get(block.id) is None
    assert repo.delete(block.id) is False


def test_feedback_is_orphaned_once_its_block_is_gone_and_survives_it(db_session):
    area = _area(db_session)
    live = _block(db_session, area.id)
    gone = _block(db_session, area.id, lat=30.005)
    repo = BlockFeedbackRepository(db_session)
    repo.put(BlockFeedback(live.id, area.id, building_count=2))
    repo.put(BlockFeedback(gone.id, area.id, building_count=5))
    db_session.execute(delete(BlockModel).where(BlockModel.id == gone.id))

    listed = {entry.feedback.block_id: entry.orphaned for entry in repo.list_for_import_area(area.id)}

    assert listed == {live.id: False, gone.id: True}


def test_feedback_listing_is_per_area(db_session):
    area = _area(db_session)
    other = _area(db_session, lat=30.1)
    repo = BlockFeedbackRepository(db_session)
    repo.put(BlockFeedback(_block(db_session, area.id).id, area.id, building_count=1))
    repo.put(BlockFeedback(_block(db_session, other.id, lat=30.101).id, other.id, building_count=1))

    assert len(repo.list_for_import_area(area.id)) == 1


@pytest.mark.parametrize(
    ("building_count", "no_buildings"),
    [(3, True), (None, False)],
    ids=["both set", "neither set"],
)
def test_the_database_rejects_feedback_that_is_not_exactly_one_kind(db_session, building_count, no_buildings):
    area = _area(db_session)
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO block_feedback (block_id, import_area_id, building_count, no_buildings) "
                "VALUES (:block_id, :area_id, :count, :none)"
            ),
            {"block_id": uuid.uuid4(), "area_id": area.id, "count": building_count, "none": no_buildings},
        )
