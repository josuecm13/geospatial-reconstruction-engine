import uuid

import pytest

from app.domain.area_feature import AreaFeature
from app.domain.bounding_box import BoundingBox, Coordinate, InvalidBoundingBox
from app.domain.building import Building
from app.domain.enums import AreaFeatureKind, BuildingCategory, RoadClassification
from app.domain.geometry import linestring_length_meters
from app.domain.poi import PointOfInterest
from app.domain.enums import PoiCategory
from app.domain.road_graph import NavigableNode, Road, RoadSegment
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.poi import PointOfInterestRepository
from app.persistence.repositories.road_graph import (
    NavigableNodeRepository,
    RoadRepository,
    RoadSegmentRepository,
)
from app.persistence.repositories.traced_boundary import TracedBoundaryRepository
from app.persistence.spatial_queries import (
    InvalidSpatialQuery,
    SpatialQueryService,
    UnknownImportArea,
    UnknownTracedBoundary,
)


def _import_area_id(db_session, min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.005, -97.795)):
    bbox = BoundingBox(min_corner=min_corner, max_corner=max_corner)
    return ImportAreaRepository(db_session).get_or_create("osm", bbox).id


def _square_ring(min_lat, min_lon, max_lat, max_lon):
    return (
        Coordinate(min_lat, min_lon),
        Coordinate(min_lat, max_lon),
        Coordinate(max_lat, max_lon),
        Coordinate(max_lat, min_lon),
        Coordinate(min_lat, min_lon),
    )


def test_node_within_radius_is_returned(db_session):
    import_area_id = _import_area_id(db_session)
    center = Coordinate(30.0, -97.8)
    close = NavigableNodeRepository(db_session).upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/close", point=Coordinate(30.0, -97.7995))
    )

    results = SpatialQueryService(db_session).nodes_within_radius(import_area_id, center, radius_meters=100)

    assert close.id in {n.id for n in results}


def test_node_outside_radius_is_excluded(db_session):
    import_area_id = _import_area_id(db_session)
    center = Coordinate(30.0, -97.8)
    far = NavigableNodeRepository(db_session).upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/far", point=Coordinate(30.01, -97.8))
    )

    results = SpatialQueryService(db_session).nodes_within_radius(import_area_id, center, radius_meters=100)

    assert far.id not in {n.id for n in results}


def test_radius_query_with_no_match_returns_empty_list(db_session):
    import_area_id = _import_area_id(db_session)

    results = SpatialQueryService(db_session).pois_within_radius(
        import_area_id, Coordinate(30.0, -97.8), radius_meters=10
    )

    assert results == []


def test_radius_query_is_isolated_by_import_area(db_session):
    area_a = _import_area_id(db_session, Coordinate(30.0, -97.8), Coordinate(30.005, -97.795))
    area_b = _import_area_id(db_session, Coordinate(31.0, -98.8), Coordinate(31.005, -98.795))
    center = Coordinate(30.0, -97.8)

    NavigableNodeRepository(db_session).upsert(
        NavigableNode(id=None, import_area_id=area_a, source_id="node/a", point=center)
    )
    # Same coordinates, different area: must never leak into area_a's results.
    NavigableNodeRepository(db_session).upsert(
        NavigableNode(id=None, import_area_id=area_b, source_id="node/b", point=Coordinate(31.0, -98.8))
    )

    results = SpatialQueryService(db_session).nodes_within_radius(area_a, center, radius_meters=50)

    assert all(node.import_area_id == area_a for node in results)


def test_poi_within_radius_is_returned(db_session):
    import_area_id = _import_area_id(db_session)
    PointOfInterestRepository(db_session).upsert(
        PointOfInterest(
            id=None,
            import_area_id=import_area_id,
            source_id="node/poi-close",
            category=PoiCategory.SHOPPING,
            point=Coordinate(30.0, -97.7999),
        )
    )

    results = SpatialQueryService(db_session).pois_within_radius(
        import_area_id, Coordinate(30.0, -97.8), radius_meters=50
    )

    assert len(results) == 1


def test_building_straddling_bbox_is_intersecting_not_contained(db_session):
    import_area_id = _import_area_id(db_session)
    bbox = BoundingBox(min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.001, -97.799))
    straddling = BuildingRepository(db_session).upsert(
        Building(
            id=None,
            import_area_id=import_area_id,
            source_id="way/straddling",
            category=BuildingCategory.RESIDENTIAL,
            geom=_square_ring(30.0002, -97.7992, 30.0004, -97.7988),
        )
    )

    service = SpatialQueryService(db_session)
    intersecting = {b.id for b in service.buildings_intersecting_bbox(import_area_id, bbox)}
    contained = {b.id for b in service.buildings_contained_by_bbox(import_area_id, bbox)}

    assert straddling.id in intersecting
    assert straddling.id not in contained


def test_building_fully_inside_bbox_is_both_intersecting_and_contained(db_session):
    import_area_id = _import_area_id(db_session)
    bbox = BoundingBox(min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.001, -97.799))
    inside = BuildingRepository(db_session).upsert(
        Building(
            id=None,
            import_area_id=import_area_id,
            source_id="way/inside",
            category=BuildingCategory.RESIDENTIAL,
            geom=_square_ring(30.0002, -97.7999, 30.0004, -97.7996),
        )
    )

    service = SpatialQueryService(db_session)
    intersecting = {b.id for b in service.buildings_intersecting_bbox(import_area_id, bbox)}
    contained = {b.id for b in service.buildings_contained_by_bbox(import_area_id, bbox)}

    assert inside.id in intersecting
    assert inside.id in contained


def test_area_feature_bbox_containment(db_session):
    import_area_id = _import_area_id(db_session)
    bbox = BoundingBox(min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.001, -97.799))
    AreaFeatureRepository(db_session).upsert(
        AreaFeature(
            id=None,
            import_area_id=import_area_id,
            source_id="way/park",
            kind=AreaFeatureKind.PARK,
            geom=_square_ring(30.0002, -97.7999, 30.0004, -97.7996),
        )
    )

    contained = SpatialQueryService(db_session).area_features_contained_by_bbox(import_area_id, bbox)

    assert len(contained) == 1


def test_building_footprint_area_in_square_meters(db_session):
    import_area_id = _import_area_id(db_session)
    ring = _square_ring(30.0, -97.8, 30.001, -97.799)
    building = BuildingRepository(db_session).upsert(
        Building(
            id=None,
            import_area_id=import_area_id,
            source_id="way/footprint",
            category=BuildingCategory.RESIDENTIAL,
            geom=ring,
        )
    )

    width = linestring_length_meters((ring[0], ring[1]))
    height = linestring_length_meters((ring[1], ring[2]))
    expected = width * height

    area = SpatialQueryService(db_session).building_footprint_area_square_meters(import_area_id, building.id)

    assert area == pytest.approx(expected, rel=0.02)


def test_footprint_area_of_unknown_building_raises(db_session):
    import_area_id = _import_area_id(db_session)

    with pytest.raises(UnknownImportArea):
        SpatialQueryService(db_session).building_footprint_area_square_meters(import_area_id, uuid.uuid4())


def _build_two_segments_at_different_distances(db_session, import_area_id):
    road = RoadRepository(db_session).upsert(
        Road(
            id=None,
            import_area_id=import_area_id,
            source_id="way/near-far",
            classification=RoadClassification.RESIDENTIAL,
            geom=(Coordinate(30.0, -97.8), Coordinate(30.01, -97.8)),
        )
    )
    node_repo = NavigableNodeRepository(db_session)
    close_a = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/close-a", point=Coordinate(30.0, -97.7999))
    )
    close_b = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/close-b", point=Coordinate(30.0002, -97.7999))
    )
    far_a = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/far-a", point=Coordinate(30.01, -97.8))
    )
    far_b = node_repo.upsert(
        NavigableNode(id=None, import_area_id=import_area_id, source_id="node/far-b", point=Coordinate(30.0102, -97.8))
    )
    segment_repo = RoadSegmentRepository(db_session)
    close_segment = segment_repo.upsert(
        RoadSegment(id=None, road_id=road.id, from_node_id=close_a.id, to_node_id=close_b.id, geom=(close_a.point, close_b.point))
    )
    far_segment = segment_repo.upsert(
        RoadSegment(id=None, road_id=road.id, from_node_id=far_a.id, to_node_id=far_b.id, geom=(far_a.point, far_b.point))
    )
    return close_a, close_segment, far_segment


def test_nearest_node_returns_closest_of_several_candidates(db_session):
    import_area_id = _import_area_id(db_session)
    close_a, _, _ = _build_two_segments_at_different_distances(db_session, import_area_id)

    nearest = SpatialQueryService(db_session).nearest_node(import_area_id, Coordinate(30.0, -97.8))

    assert nearest.id == close_a.id


def test_nearest_node_reports_absence_when_none_exist(db_session):
    import_area_id = _import_area_id(db_session)

    nearest = SpatialQueryService(db_session).nearest_node(import_area_id, Coordinate(30.0, -97.8))

    assert nearest is None


def test_nearest_segment_returns_closest(db_session):
    import_area_id = _import_area_id(db_session)
    _, close_segment, far_segment = _build_two_segments_at_different_distances(db_session, import_area_id)

    nearest = SpatialQueryService(db_session).nearest_segment(import_area_id, Coordinate(30.0, -97.8))

    assert nearest.id == close_segment.id
    assert nearest.id != far_segment.id


def test_unknown_import_area_raises(db_session):
    with pytest.raises(UnknownImportArea):
        SpatialQueryService(db_session).nodes_within_radius(uuid.uuid4(), Coordinate(30.0, -97.8), radius_meters=10)


def test_negative_radius_raises(db_session):
    import_area_id = _import_area_id(db_session)

    with pytest.raises(InvalidSpatialQuery):
        SpatialQueryService(db_session).nodes_within_radius(import_area_id, Coordinate(30.0, -97.8), radius_meters=-1)


def test_zero_radius_raises(db_session):
    import_area_id = _import_area_id(db_session)

    with pytest.raises(InvalidSpatialQuery):
        SpatialQueryService(db_session).nodes_within_radius(import_area_id, Coordinate(30.0, -97.8), radius_meters=0)


def test_out_of_range_coordinate_is_rejected_by_construction():
    with pytest.raises(InvalidBoundingBox):
        Coordinate(latitude=95.0, longitude=-97.8)


def test_scope_to_a_boundary_of_another_import_area_raises(db_session):
    repo = ImportAreaRepository(db_session)
    area = repo.get_or_create("osm", BoundingBox(Coordinate(30.0, -97.8), Coordinate(30.005, -97.795)))
    other = repo.get_or_create("osm", BoundingBox(Coordinate(31.0, -97.8), Coordinate(31.005, -97.795)))
    foreign = TracedBoundaryRepository(db_session).create(other, "Other", _square_ring(31.001, -97.799, 31.002, -97.798))
    service = SpatialQueryService(db_session)

    with pytest.raises(UnknownTracedBoundary):
        service.nodes_within_radius(area.id, Coordinate(30.001, -97.799), 100, boundary_id=foreign.id)
    with pytest.raises(UnknownTracedBoundary):
        service.nearest_segment(area.id, Coordinate(30.001, -97.799), boundary_id=foreign.id)
