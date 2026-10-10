"""Where buildings may go inside an eligible block, and the block's settlement style.

Everything is in local metres. The input is the block's buildable area; water, steep ground and
non-residential land use are subtracted, each leaving a zone for display. The front setback is added
later, by the generator, once the block's reference is matched (`Suitability.with_setback`)."""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field, replace

from shapely.geometry import LineString as ShapelyLineString
from shapely.geometry import MultiPolygon as ShapelyMultiPolygon
from shapely.geometry import Point
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.geometry import box as shapely_box
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points, unary_union
from shapely.validation import make_valid

from app.domain.area_feature import AreaFeature
from app.domain.block import Block
from app.domain.elevation import ElevationGrid
from app.domain.enums import AreaFeatureKind
from app.domain.generation import (
    INFORMAL_WATER_DISTANCE_METERS,
    STEEP_SLOPE,
    STYLE_CONTEXT_RADIUS_METERS,
    WATER_BUFFER_METERS,
    SettlementStyle,
    ZoneReason,
    is_near_low_water,
    settlement_style,
)
from app.domain.geometry import LineString, Polygon
from app.domain.local_projection import LocalProjection
from app.generation.geometry import (
    as_multipolygon,
    from_local_xy,
    linestring_to_local,
    multipolygon_to_local,
    polygon_to_local,
    polygons_of,
    to_local_xy,
)

LANDUSE_EXCLUDED_KINDS = frozenset(
    {
        AreaFeatureKind.FOREST,
        AreaFeatureKind.FARMLAND,
        AreaFeatureKind.CEMETERY,
        AreaFeatureKind.RAILWAY,
        AreaFeatureKind.INDUSTRIAL,
        AreaFeatureKind.PARK,
    }
)

Zone = tuple[ZoneReason, BaseGeometry]


@dataclass(frozen=True)
class Suitability:
    """`buildable` is the block's buildable area and `suitable` what is left of it for buildings,
    both in local metres. `zones` are what was taken out, one geometry per reason."""

    buildable: ShapelyMultiPolygon
    suitable: ShapelyMultiPolygon
    zones: tuple[Zone, ...]
    style: SettlementStyle
    projection: LocalProjection = field(compare=False)

    def with_setback(self, strip: BaseGeometry) -> "Suitability":
        """The hook for the generator: subtract the front setback strip once the block's reference
        is matched, and record it as the `setback` zone (only the part inside the buildable area)."""
        zone = strip.intersection(self.buildable)
        if zone.is_empty:
            return self
        return replace(
            self,
            suitable=as_multipolygon(self.suitable.difference(strip)),
            zones=(*self.zones, (ZoneReason.SETBACK, zone)),
        )


def suitability(
    block: Block,
    *,
    projection: LocalProjection,
    water: Sequence[AreaFeature],
    landuse: Sequence[AreaFeature],
    grid: ElevationGrid | None,
    roads_nearby: Sequence[LineString],
    area_of_context: Polygon,
) -> Suitability:
    """`water` and `landuse` are the area's features (others are ignored: only `water` counts as
    water, and only the land-use kinds in `LANDUSE_EXCLUDED_KINDS` are excluded). `grid` is None for
    an area without elevation: no steep zone, and the style is never `informal`.
    `roads_nearby` are the area's road segments within about 500 m of the block (their length is
    clipped to the 500 m circle to give the road density behind `sparse`), and `area_of_context` is
    the import area's outline, so land beyond it doesn't count as empty."""
    if block.buildable_area is None:
        raise ValueError("suitability needs a block with a buildable area")
    buildable = _valid(multipolygon_to_local(projection, block.buildable_area))

    water_shapes = [_valid(polygon_to_local(projection, feature.geom)) for feature in water if feature.kind == AreaFeatureKind.WATER]
    landuse_shapes = [
        _valid(polygon_to_local(projection, feature.geom)) for feature in landuse if feature.kind in LANDUSE_EXCLUDED_KINDS
    ]

    zones: list[Zone] = []
    suitable: BaseGeometry = buildable

    def exclude(reason: ZoneReason, shape: BaseGeometry) -> None:
        nonlocal suitable
        zone = shape.intersection(buildable)
        if zone.is_empty or not polygons_of(zone):
            return
        zones.append((reason, zone))
        suitable = suitable.difference(shape)

    if water_shapes:
        exclude(ZoneReason.WATER, unary_union(water_shapes).buffer(WATER_BUFFER_METERS))
    if grid is not None:
        steep = _steep_ground(grid, projection, buildable.bounds)
        if steep is not None:
            exclude(ZoneReason.STEEP, steep)
    if landuse_shapes:
        exclude(ZoneReason.LANDUSE, unary_union(landuse_shapes))

    suitable_area = as_multipolygon(suitable)
    style = _style(
        block,
        projection=projection,
        centre_source=suitable_area if not suitable_area.is_empty else buildable,
        water_shapes=water_shapes,
        grid=grid,
        roads=[linestring_to_local(projection, line) for line in roads_nearby],
        context=polygon_to_local(projection, area_of_context),
    )
    return Suitability(buildable, suitable_area, tuple(zones), style, projection)


def _valid(geometry: BaseGeometry) -> BaseGeometry:
    return geometry if geometry.is_valid else make_valid(geometry)


def _steep_ground(grid: ElevationGrid, projection: LocalProjection, bounds: tuple[float, float, float, float]) -> BaseGeometry | None:
    """The grid cells steeper than `STEEP_SLOPE` that can touch `bounds`, unioned; None when there
    are none. A cell's slope is the magnitude of its gradient: the mean height difference across the
    cell on each axis over the cell's size in metres."""
    cell_width = grid.lon_step * projection.meters_per_degree_longitude
    cell_height = grid.lat_step * projection.meters_per_degree_latitude
    min_x, min_y, max_x, max_y = bounds
    south_west = from_local_xy(projection, min_x, min_y)
    north_east = from_local_xy(projection, max_x, max_y)
    row_low = max(math.floor((south_west.latitude - grid.origin.latitude) / grid.lat_step), 0)
    row_high = min(math.ceil((north_east.latitude - grid.origin.latitude) / grid.lat_step), grid.rows - 2)
    col_low = max(math.floor((south_west.longitude - grid.origin.longitude) / grid.lon_step), 0)
    col_high = min(math.ceil((north_east.longitude - grid.origin.longitude) / grid.lon_step), grid.cols - 2)

    cells: list[BaseGeometry] = []
    for row in range(row_low, row_high + 1):
        for col in range(col_low, col_high + 1):
            h00, h01 = grid.height_at(row, col), grid.height_at(row, col + 1)
            h10, h11 = grid.height_at(row + 1, col), grid.height_at(row + 1, col + 1)
            gradient_x = ((h01 - h00) + (h11 - h10)) / 2 / cell_width
            gradient_y = ((h10 - h00) + (h11 - h01)) / 2 / cell_height
            if math.hypot(gradient_x, gradient_y) <= STEEP_SLOPE:
                continue
            x0, y0 = to_local_xy(projection, grid.coordinate_at(row, col))
            cells.append(shapely_box(x0, y0, x0 + cell_width, y0 + cell_height))
    return unary_union(cells) if cells else None


def _style(
    block: Block,
    *,
    projection: LocalProjection,
    centre_source: BaseGeometry,
    water_shapes: list[BaseGeometry],
    grid: ElevationGrid | None,
    roads: list[ShapelyLineString],
    context: ShapelyPolygon,
) -> SettlementStyle:
    near_low_water = False
    if grid is not None and water_shapes:
        centre = centre_source.centroid
        water = unary_union(water_shapes)
        distance = centre.distance(water)
        if distance <= INFORMAL_WATER_DISTANCE_METERS:  # skip the sampling when it cannot qualify
            nearest = nearest_points(centre, water)[1]
            ground = grid.sample(from_local_xy(projection, centre.x, centre.y))
            water_ground = grid.sample(from_local_xy(projection, nearest.x, nearest.y))
            near_low_water = is_near_low_water(distance, ground - water_ground)

    block_centre = polygon_to_local(projection, block.boundary).centroid
    circle = Point(block_centre).buffer(STYLE_CONTEXT_RADIUS_METERS)
    land = circle.intersection(context)
    if water_shapes:
        land = land.difference(unary_union(water_shapes))
    land_area = land.area
    if land_area > 0:
        road_km = sum(line.intersection(land).length for line in roads if line.intersects(land)) / 1000.0
        density = road_km / (land_area / 1_000_000.0)
    else:
        density = 0.0
    return settlement_style(near_low_water=near_low_water, road_density_km_per_km2=density)
