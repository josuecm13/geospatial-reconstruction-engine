from app.domain.area_feature import AreaFeature
from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.building import Building
from app.domain.enums import AreaFeatureKind, BuildingCategory, PoiCategory, RoadClassification
from app.domain.poi import PointOfInterest
from app.domain.road_graph import NavigableNode, Road, RoadSegment
from app.persistence.block_derivation import BlockDerivationService
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.poi import PointOfInterestRepository
from app.persistence.repositories.road_graph import NavigableNodeRepository, RoadRepository, RoadSegmentRepository


def _import_area_id(db_session):
    bbox = BoundingBox(
        min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.005, -97.795)
    )
    return ImportAreaRepository(db_session).get_or_create("osm", bbox).id


def _square_ring(min_lat, min_lon, max_lat, max_lon):
    return (
        Coordinate(min_lat, min_lon),
        Coordinate(min_lat, max_lon),
        Coordinate(max_lat, max_lon),
        Coordinate(max_lat, min_lon),
        Coordinate(min_lat, min_lon),
    )


def test_building_upsert_is_idempotent(db_session):
    import_area_id = _import_area_id(db_session)
    repo = BuildingRepository(db_session)
    building = Building(
        id=None,
        import_area_id=import_area_id,
        source_id="way/building-1",
        category=BuildingCategory.RESIDENTIAL,
        geom=_square_ring(30.0, -97.8, 30.0001, -97.7999),
    )

    first = repo.upsert(building)
    second = repo.upsert(building)

    assert first.id == second.id
    assert first.category == BuildingCategory.RESIDENTIAL


def test_poi_upsert_is_idempotent(db_session):
    import_area_id = _import_area_id(db_session)
    repo = PointOfInterestRepository(db_session)
    poi = PointOfInterest(
        id=None,
        import_area_id=import_area_id,
        source_id="node/poi-1",
        category=PoiCategory.SHOPPING,
        point=Coordinate(30.0, -97.8),
        name="Corner Store",
    )

    first = repo.upsert(poi)
    second = repo.upsert(poi)

    assert first.id == second.id
    assert first.category == PoiCategory.SHOPPING


def test_area_feature_upsert_is_idempotent(db_session):
    import_area_id = _import_area_id(db_session)
    repo = AreaFeatureRepository(db_session)
    feature = AreaFeature(
        id=None,
        import_area_id=import_area_id,
        source_id="way/park-1",
        kind=AreaFeatureKind.PARK,
        geom=_square_ring(30.0, -97.8, 30.0005, -97.7995),
    )

    first = repo.upsert(feature)
    second = repo.upsert(feature)

    assert first.id == second.id
    assert first.kind == AreaFeatureKind.PARK


def _build_square_block(db_session, import_area_id):
    road = RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id="way/block-loop",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, -97.8), Coordinate(30.0, -97.799)),
        )
    )
    node_repo = NavigableNodeRepository(db_session)
    sw = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/bsw", point=Coordinate(30.0, -97.8))
    )
    se = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/bse", point=Coordinate(30.0, -97.799))
    )
    ne = node_repo.upsert(
        NavigableNode(
            id=None, import_area_id=import_area_id, source_id="node/bne", point=Coordinate(30.001, -97.799)
        )
    )
    nw = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/bnw", point=Coordinate(30.001, -97.8))
    )
    segment_repo = RoadSegmentRepository(db_session)
    for a, b in [(sw, se), (se, ne), (ne, nw), (nw, sw)]:
        segment_repo.upsert(
            RoadSegment(id=None, road_id=road.id, from_node_id=a.id, to_node_id=b.id, geom=(a.point, b.point))
        )

    return BlockDerivationService(db_session).derive_for_import_area(import_area_id)[0]


def test_building_inside_block_is_linked(db_session):
    import_area_id = _import_area_id(db_session)
    block = _build_square_block(db_session, import_area_id)

    building_repo = BuildingRepository(db_session)
    building = building_repo.upsert(
        Building(
            id=None,
            import_area_id=import_area_id,
            source_id="way/inside-building",
            category=BuildingCategory.RESIDENTIAL,
            geom=_square_ring(30.0002, -97.7998, 30.0004, -97.7996),
        )
    )

    building_repo.link_to_containing_block(import_area_id)
    linked = building_repo.get(building.id)

    assert linked.block_id == block.id


def test_building_outside_every_block_is_left_unlinked(db_session):
    import_area_id = _import_area_id(db_session)
    _build_square_block(db_session, import_area_id)

    building_repo = BuildingRepository(db_session)
    building = building_repo.upsert(
        Building(
            id=None,
            import_area_id=import_area_id,
            source_id="way/outside-building",
            category=BuildingCategory.RESIDENTIAL,
            geom=_square_ring(31.0, -98.8, 31.0001, -98.7999),
        )
    )

    building_repo.link_to_containing_block(import_area_id)
    unlinked = building_repo.get(building.id)

    assert unlinked.block_id is None
