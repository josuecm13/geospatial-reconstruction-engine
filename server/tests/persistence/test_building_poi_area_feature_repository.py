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
from app.persistence.models import BuildingModel
from app.persistence.repositories.road_graph import NavigableNodeRepository, RoadRepository, RoadSegmentRepository
from app.persistence.spatial_queries import SpatialQueryService


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


def test_feature_upsert_many_creates_then_updates_in_place_and_keys_by_source_id(db_session):
    area = _import_area_id(db_session)
    buildings, pois, areas = (
        BuildingRepository(db_session), PointOfInterestRepository(db_session), AreaFeatureRepository(db_session)
    )
    building_batch = [
        Building(None, area, f"way/b{i}", BuildingCategory.RESIDENTIAL, _square_ring(30.0, -97.8, 30.0001, -97.7999))
        for i in range(2)
    ]
    poi_batch = [PointOfInterest(None, area, f"node/p{i}", PoiCategory.SHOPPING, Coordinate(30.0, -97.8), "Shop") for i in range(2)]
    area_batch = [
        AreaFeature(None, area, f"way/a{i}", AreaFeatureKind.PARK, _square_ring(30.0, -97.8, 30.0001, -97.7999))
        for i in range(2)
    ]

    first = (buildings.upsert_many(area, building_batch), pois.upsert_many(area, poi_batch), areas.upsert_many(area, area_batch))
    second = (buildings.upsert_many(area, building_batch), pois.upsert_many(area, poi_batch), areas.upsert_many(area, area_batch))

    for created, updated, prefix in zip(first, second, ("way/b", "node/p", "way/a")):
        assert set(created) == {f"{prefix}0", f"{prefix}1"}
        assert {k: v.id for k, v in created.items()} == {k: v.id for k, v in updated.items()}
    assert len(buildings.list_for_import_area(area)) == 2
    assert len(pois.list_for_import_area(area)) == 2
    assert len(areas.list_for_import_area(area)) == 2


def test_feature_upsert_many_with_the_same_key_twice_leaves_one_row(db_session):
    area = _import_area_id(db_session)
    buildings = BuildingRepository(db_session)
    ring = _square_ring(30.0, -97.8, 30.0001, -97.7999)

    result = buildings.upsert_many(area, [
        Building(None, area, "way/b", BuildingCategory.RESIDENTIAL, ring),
        Building(None, area, "way/b", BuildingCategory.COMMERCIAL, ring),
    ])

    assert list(result) == ["way/b"]
    assert result["way/b"].category == BuildingCategory.COMMERCIAL
    assert len(buildings.list_for_import_area(area)) == 1


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


def _unlinked_building_in_block(db_session):
    import_area_id = _import_area_id(db_session)
    block = _build_square_block(db_session, import_area_id)
    building = BuildingRepository(db_session).upsert(
        Building(
            id=None,
            import_area_id=import_area_id,
            source_id="way/stale-check-building",
            category=BuildingCategory.RESIDENTIAL,
            geom=_square_ring(30.0002, -97.7998, 30.0004, -97.7996),
        )
    )
    return import_area_id, block, building


def test_link_refreshes_a_building_the_session_still_holds_via_get(db_session):
    import_area_id, block, building = _unlinked_building_in_block(db_session)
    held = db_session.get(BuildingModel, building.id)  # keep the reference: the identity map is weak
    assert held.block_id is None

    BuildingRepository(db_session).link_to_containing_block(import_area_id)

    assert BuildingRepository(db_session).get(building.id).block_id == block.id
    assert held.block_id == block.id


def test_link_refreshes_buildings_a_session_listed_earlier(db_session):
    import_area_id, block, _ = _unlinked_building_in_block(db_session)
    repo = BuildingRepository(db_session)
    held = db_session.query(BuildingModel).filter_by(import_area_id=import_area_id).all()
    assert [b.block_id for b in repo.list_for_import_area(import_area_id)] == [None]

    repo.link_to_containing_block(import_area_id)

    assert [b.block_id for b in repo.list_for_import_area(import_area_id)] == [block.id]
    assert [m.block_id for m in held] == [block.id]


def test_link_refreshes_buildings_the_spatial_queries_return(db_session):
    import_area_id, block, building = _unlinked_building_in_block(db_session)
    held = db_session.get(BuildingModel, building.id)
    service = SpatialQueryService(db_session)
    center = Coordinate(30.0003, -97.7997)
    assert [b.block_id for b in service.buildings_within_radius(import_area_id, center, 500)] == [None]

    BuildingRepository(db_session).link_to_containing_block(import_area_id)

    assert [b.block_id for b in service.buildings_within_radius(import_area_id, center, 500)] == [block.id]
    assert held.block_id == block.id


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


def test_list_for_import_area_scopes_buildings_pois_and_area_features(db_session):
    area_one = _import_area_id(db_session)
    area_two = ImportAreaRepository(db_session).get_or_create(
        "osm", BoundingBox(Coordinate(31.0, -98.8), Coordinate(31.005, -98.795))
    ).id

    building_repo = BuildingRepository(db_session)
    poi_repo = PointOfInterestRepository(db_session)
    area_feature_repo = AreaFeatureRepository(db_session)

    building_repo.upsert(
        Building(id=None, import_area_id=area_one, source_id="way/b1", category=BuildingCategory.RESIDENTIAL,
                  geom=_square_ring(30.0, -97.8, 30.0001, -97.7999))
    )
    building_repo.upsert(
        Building(id=None, import_area_id=area_two, source_id="way/b2", category=BuildingCategory.RESIDENTIAL,
                  geom=_square_ring(31.0, -98.8, 31.0001, -98.7999))
    )
    poi_repo.upsert(
        PointOfInterest(id=None, import_area_id=area_one, source_id="node/p1", category=PoiCategory.SHOPPING,
                         point=Coordinate(30.0, -97.8), name="One")
    )
    poi_repo.upsert(
        PointOfInterest(id=None, import_area_id=area_two, source_id="node/p2", category=PoiCategory.SHOPPING,
                         point=Coordinate(31.0, -98.8), name="Two")
    )
    area_feature_repo.upsert(
        AreaFeature(id=None, import_area_id=area_one, source_id="way/park1", kind=AreaFeatureKind.PARK,
                    geom=_square_ring(30.0, -97.8, 30.0005, -97.7995))
    )
    area_feature_repo.upsert(
        AreaFeature(id=None, import_area_id=area_two, source_id="way/park2", kind=AreaFeatureKind.PARK,
                    geom=_square_ring(31.0, -98.8, 31.0005, -98.7995))
    )

    buildings_one = building_repo.list_for_import_area(area_one)
    pois_one = poi_repo.list_for_import_area(area_one)
    features_one = area_feature_repo.list_for_import_area(area_one)

    assert [b.source_id for b in buildings_one] == ["way/b1"]
    assert [p.source_id for p in pois_one] == ["node/p1"]
    assert [f.source_id for f in features_one] == ["way/park1"]


def test_navigable_node_list_for_import_area_scopes_by_area(db_session):
    from app.domain.road_graph import NavigableNode
    from app.persistence.repositories.road_graph import NavigableNodeRepository

    area_one = _import_area_id(db_session)
    area_two = ImportAreaRepository(db_session).get_or_create(
        "osm", BoundingBox(Coordinate(31.0, -98.8), Coordinate(31.005, -98.795))
    ).id
    node_repo = NavigableNodeRepository(db_session)
    node_repo.upsert(NavigableNode(id=None, import_area_id=area_one, source_id="node/n1", point=Coordinate(30.0, -97.8)))
    node_repo.upsert(NavigableNode(id=None, import_area_id=area_two, source_id="node/n2", point=Coordinate(31.0, -98.8)))

    nodes_one = node_repo.list_for_import_area(area_one)

    assert [n.source_id for n in nodes_one] == ["node/n1"]


def test_block_list_for_import_area_loads_boundary_segments_and_scopes_by_area(db_session):
    from app.persistence.repositories.block import BlockRepository

    area_one = _import_area_id(db_session)
    block = _build_square_block(db_session, area_one)
    area_two = ImportAreaRepository(db_session).get_or_create(
        "osm", BoundingBox(Coordinate(31.0, -98.8), Coordinate(31.005, -98.795))
    ).id

    blocks_one = BlockRepository(db_session).list_for_import_area(area_one)
    blocks_two = BlockRepository(db_session).list_for_import_area(area_two)

    assert len(blocks_one) == 1
    assert blocks_one[0].id == block.id
    assert set(blocks_one[0].bounding_segment_ids) == set(block.bounding_segment_ids)
    assert blocks_two == []


def test_road_segment_list_with_street_reports_name_and_classification(db_session):
    import_area_id = _import_area_id(db_session)
    road = RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id="way/named",
            classification=RoadClassification.PRIMARY,
            geom=(Coordinate(30.0, -97.8), Coordinate(30.0, -97.799)),
        )
    )
    node_repo = NavigableNodeRepository(db_session)
    a = node_repo.upsert(NavigableNode(id=None, import_area_id=import_area_id, source_id="node/a", point=Coordinate(30.0, -97.8)))
    b = node_repo.upsert(NavigableNode(id=None, import_area_id=import_area_id, source_id="node/b", point=Coordinate(30.0, -97.799)))
    RoadSegmentRepository(db_session).upsert(
        RoadSegment(id=None, road_id=road.id, from_node_id=a.id, to_node_id=b.id, geom=(a.point, b.point))
    )

    # This repository's upsert doesn't create a Street row (that belongs to
    # OSMIngestionService's persistence path); create one directly here.
    from app.domain.road_graph import Street
    from app.persistence.repositories.road_graph import StreetRepository
    from app.persistence.models import RoadModel

    street = StreetRepository(db_session).upsert(
        Street(id=None, import_area_id=import_area_id, source_id="way/named", name="Named Ave", classification=RoadClassification.SECONDARY)
    )
    db_session.execute(
        RoadModel.__table__.update().where(RoadModel.id == road.id).values(street_id=street.id)
    )

    segments = RoadSegmentRepository(db_session).list_for_import_area_with_street(import_area_id)

    assert len(segments) == 1
    assert segments[0].street_name == "Named Ave"
    # The street's and the road's own classification are reported separately:
    # a logical street can group roads of different classes.
    assert segments[0].street_classification == RoadClassification.SECONDARY
    assert segments[0].road_classification == RoadClassification.PRIMARY
