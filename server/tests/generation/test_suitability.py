import uuid

from shapely.geometry import box

from app.domain.area_feature import AreaFeature
from app.domain.block import Block
from app.domain.bounding_box import Coordinate
from app.domain.elevation import ElevationGrid
from app.domain.enums import AreaFeatureKind
from app.domain.generation import SettlementStyle, ZoneReason
from app.domain.local_projection import local_projection_for
from app.generation.suitability import suitability

AREA_ID = uuid.uuid4()


def _rect(min_lat, min_lon, max_lat, max_lon):
    return (
        Coordinate(min_lat, min_lon),
        Coordinate(min_lat, max_lon),
        Coordinate(max_lat, max_lon),
        Coordinate(max_lat, min_lon),
        Coordinate(min_lat, min_lon),
    )


# The area is 0.0022 degrees square at the equator (about 245 m); the block's buildable area is
# inset from its 0.002-degree boundary by about 11 m.
CONTEXT = _rect(0.0, 0.0, 0.0022, 0.0022)
PROJECTION = local_projection_for(CONTEXT)
BUILDABLE = _rect(0.0001, 0.0001, 0.0019, 0.0019)
BLOCK = Block(
    id=uuid.uuid4(),
    import_area_id=AREA_ID,
    boundary=_rect(0.0, 0.0, 0.002, 0.002),
    area_square_meters=49_000.0,
    buildable_area=(BUILDABLE,),
    buildable_area_square_meters=40_000.0,
)
def _line(*points):
    return tuple(Coordinate(lat, lon) for lat, lon in points)


# Five 245 m streets across the 0.06 km2 context: about 20 km of road per km2 (the sparse threshold is 6).
STREET_GRID = tuple(_line((lat, 0.0), (lat, 0.0022)) for lat in (0.0002, 0.0007, 0.0012, 0.0017, 0.0021))
# Two 100 m streets: about 3.3 km per km2.
TWO_ROADS = (_line((0.0010, 0.0), (0.0010, 0.0009)), _line((0.0, 0.0010), (0.0009, 0.0010)))


def _feature(kind, ring):
    return AreaFeature(id=None, import_area_id=AREA_ID, source_id=f"way/{kind.value}", kind=kind, geom=ring)


def _grid(height_for_col):
    rows = cols = 12
    return ElevationGrid(
        origin=Coordinate(0.0, 0.0),
        lat_step=0.0002,
        lon_step=0.0002,
        rows=rows,
        cols=cols,
        heights=tuple(height_for_col(col) for _ in range(rows) for col in range(cols)),
    )


def _run(*, water=(), landuse=(), grid=None, roads=STREET_GRID):
    return suitability(
        BLOCK,
        projection=PROJECTION,
        water=list(water),
        landuse=list(landuse),
        grid=grid,
        roads_nearby=list(roads),
        area_of_context=CONTEXT,
    )


def _reasons(result):
    return [reason for reason, _ in result.zones]


def test_with_nothing_to_exclude_the_whole_buildable_area_is_suitable():
    result = _run()

    assert result.zones == ()
    assert abs(result.suitable.area - result.buildable.area) < 1e-6


def test_water_is_excluded_with_a_20_metre_buffer():
    # Water starts 11 m east of the buildable area: a 20 m buffer takes about 9 m of it.
    water = _feature(AreaFeatureKind.WATER, _rect(0.0, 0.0020, 0.0022, 0.0025))

    result = _run(water=[water])

    assert _reasons(result) == [ZoneReason.WATER]
    shrink = result.buildable.bounds[2] - result.suitable.bounds[2]
    assert 7.0 < shrink < 11.0


def test_water_further_than_the_buffer_excludes_nothing():
    water = _feature(AreaFeatureKind.WATER, _rect(0.0, 0.0030, 0.0022, 0.0035))

    assert _run(water=[water]).zones == ()


def test_a_steep_strip_is_excluded_only_with_a_grid():
    # Flat up to column 5 (longitude 0.001), then rising 10 m per 22 m column: slope of 45%.
    grid = _grid(lambda col: 0.0 if col <= 5 else 10.0 * (col - 5))

    with_grid = _run(grid=grid)
    without_grid = _run(grid=None)

    assert _reasons(with_grid) == [ZoneReason.STEEP]
    east_edge_of_flat_ground = 0.0010 * PROJECTION.meters_per_degree_longitude
    assert with_grid.suitable.bounds[2] <= east_edge_of_flat_ground + 1e-6
    assert without_grid.zones == ()
    assert without_grid.suitable.bounds[2] == without_grid.buildable.bounds[2]


def test_gentle_ground_is_not_steep():
    grid = _grid(lambda col: 2.0 * col)  # 2 m per 22 m column: 9%

    assert _run(grid=grid).zones == ()


def test_landuse_is_excluded_but_green_space_is_not():
    forest = _feature(AreaFeatureKind.FOREST, _rect(-0.001, 0.0010, 0.003, 0.003))
    green = _feature(AreaFeatureKind.GREEN_SPACE, _rect(-0.001, 0.0, 0.003, 0.003))

    only_green = _run(landuse=[green])
    result = _run(landuse=[forest])

    assert only_green.zones == ()
    assert _reasons(result) == [ZoneReason.LANDUSE]
    assert result.suitable.bounds[2] <= 0.0010 * PROJECTION.meters_per_degree_longitude + 1e-6


def test_the_setback_hook_subtracts_a_strip_and_records_a_zone():
    result = _run()
    min_x, min_y, max_x, max_y = result.buildable.bounds
    setback = box(min_x - 1, min_y - 1, min_x + 4, max_y + 1)

    with_setback = result.with_setback(setback)

    assert _reasons(with_setback) == [ZoneReason.SETBACK]
    assert with_setback.suitable.bounds[0] >= min_x + 4 - 1e-6


def test_style_is_informal_near_low_water():
    water = _feature(AreaFeatureKind.WATER, _rect(0.0, 0.0020, 0.0022, 0.0025))

    result = _run(water=[water], grid=_grid(lambda col: 0.0))

    assert result.style is SettlementStyle.INFORMAL


def test_style_is_not_informal_when_the_block_is_well_above_the_water():
    water = _feature(AreaFeatureKind.WATER, _rect(0.0, 0.0020, 0.0022, 0.0025))
    grid = _grid(lambda col: 0.0 if col >= 10 else 10.0)

    result = _run(water=[water], grid=grid)

    assert result.style is SettlementStyle.REGULAR


def test_style_is_never_informal_without_a_grid():
    water = _feature(AreaFeatureKind.WATER, _rect(0.0, 0.0020, 0.0022, 0.0025))

    assert _run(water=[water], grid=None).style is SettlementStyle.REGULAR


def test_style_is_sparse_with_little_road_density():
    assert _run(roads=TWO_ROADS).style is SettlementStyle.SPARSE


def test_style_is_sparse_with_no_roads_at_all():
    assert _run(roads=()).style is SettlementStyle.SPARSE


def test_style_is_regular_with_a_dense_street_grid_however_few_buildings_are_mapped():
    # Suitability takes no buildings: an under-mapped town with a full street grid is not rural.
    assert _run(roads=STREET_GRID).style is SettlementStyle.REGULAR


def test_style_ignores_roads_outside_the_context():
    outside = (_line((0.0010, 0.01), (0.0010, 0.02)),)

    assert _run(roads=outside).style is SettlementStyle.SPARSE
