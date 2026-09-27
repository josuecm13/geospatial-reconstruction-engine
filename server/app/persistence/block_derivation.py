import uuid
from dataclasses import dataclass

from geoalchemy2.shape import from_shape
from shapely import wkt as shapely_wkt
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.orm import Session

from app.domain.block import MIN_BUILDABLE_WIDTH_METERS, Block
from app.domain.bounding_box import Coordinate
from app.domain.cross_section import cross_sections_by_classified_segment
from app.persistence.geometry import geom_to_multipolygon
from app.persistence.models import BlockBoundarySegmentModel, BlockModel, BuildingModel, RoadModel, RoadSegmentModel
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.road_graph import RoadSegmentRepository

SRID = 4326
# Noding computes crossing points in floating point, so "lies along" a line is
# tested within ~0.1 mm, and a shared stretch must be longer than ~1 cm to count.
_COLLINEAR_TOLERANCE_DEGREES = 1e-9
_MIN_SHARED_LENGTH_DEGREES = 1e-7


class BlockDerivationService:
    """Derives block polygons from an import area's road graph via ST_Polygonize.

    The bounding box's ring is polygonized with the road segments, so roads that
    leave the box close the blocks along its edge; those are flagged as clipped.

    Not sourced from OSM: a block only exists because the enclosing road segments do.
    """

    def __init__(self, session: Session):
        self.session = session

    def clear_for_import_area(self, import_area_id: uuid.UUID) -> None:
        """Remove an area's derived blocks so its road segments can be swept and re-derived.

        Clears buildings.block_id first (nothing references a block except
        buildings), then block_boundary_segments, then the blocks themselves —
        no foreign key here cascades. Safe to call on an area with no blocks yet.
        """
        self.session.execute(
            update(BuildingModel)
            .where(BuildingModel.import_area_id == import_area_id)
            .values(block_id=None)
        )
        block_ids = select(BlockModel.id).where(BlockModel.import_area_id == import_area_id)
        self.session.execute(
            delete(BlockBoundarySegmentModel).where(BlockBoundarySegmentModel.block_id.in_(block_ids))
        )
        self.session.execute(delete(BlockModel).where(BlockModel.import_area_id == import_area_id))
        self.session.flush()

    def rederive_for_import_area(self, import_area_id: uuid.UUID) -> tuple[list[Block], int]:
        """Replace an area's blocks and building links, standalone (outside an import).

        Equivalent to what `OSMIngestionService._persist` does across the sweep,
        but with no segment reconciliation in between — for direct re-derivation
        of an area whose road graph did not change.
        """
        self.clear_for_import_area(import_area_id)
        blocks = self.derive_for_import_area(import_area_id)
        linked_building_count = BuildingRepository(self.session).link_to_containing_block(import_area_id)
        return blocks, linked_building_count

    def derive_for_import_area(self, import_area_id: uuid.UUID) -> list[Block]:
        cross_sections = cross_sections_by_classified_segment(
            RoadSegmentRepository(self.session).list_for_import_area_with_road_classification(import_area_id)
        )
        candidate_rows = self.session.execute(
            text(
                """
                WITH area AS (
                    SELECT bbox FROM import_areas WHERE id = :import_area_id
                ),
                segments AS (
                    SELECT rs.geom
                    FROM road_segments rs
                    JOIN roads r ON r.id = rs.road_id
                    WHERE r.import_area_id = :import_area_id
                ),
                near_roads AS (
                    SELECT ST_Buffer(ST_Union(geom), :tolerance) AS geom FROM segments
                ),
                near_crossing_roads AS (
                    SELECT ST_Buffer(ST_Union(segments.geom), :tolerance) AS geom
                    FROM segments, area
                    WHERE NOT ST_CoveredBy(segments.geom, area.bbox)
                ),
                faces AS (
                    SELECT (ST_Dump(ST_Polygonize(ARRAY[ST_Node(ST_Union(geom))]))).geom AS geom
                    FROM (SELECT geom FROM segments UNION ALL SELECT ST_ExteriorRing(bbox) FROM area) AS lines
                ),
                candidates AS (
                    -- Faces come from roads and the box's ring, so any stretch of a face's
                    -- exterior that isn't along a road is along the box: the face is clipped.
                    SELECT faces.geom,
                           ST_Length(ST_Difference(ST_ExteriorRing(faces.geom), near_roads.geom)) > :min_shared_length
                               AS is_clipped
                    FROM faces, area, near_roads
                    WHERE ST_Within(ST_PointOnSurface(faces.geom), area.bbox)  -- faces outside the box aren't blocks
                )
                SELECT ST_AsText(candidates.geom) AS boundary_wkt, candidates.is_clipped
                FROM candidates LEFT JOIN near_crossing_roads ON true
                -- A clipped face is an edge block only where roads leave the box to close it.
                -- Otherwise it's what's left of the box around loops that stay inside it or
                -- merely touch its edge.
                WHERE NOT candidates.is_clipped
                   OR ST_Length(ST_Intersection(ST_ExteriorRing(candidates.geom), near_crossing_roads.geom))
                          > :min_shared_length
                """
            ),
            {
                "import_area_id": str(import_area_id),
                "tolerance": _COLLINEAR_TOLERANCE_DEGREES,
                "min_shared_length": _MIN_SHARED_LENGTH_DEGREES,
            },
        ).fetchall()

        blocks: list[Block] = []
        for row in candidate_rows:
            shapely_polygon = shapely_wkt.loads(row.boundary_wkt)
            boundary_geom = from_shape(shapely_polygon, srid=SRID)

            area_square_meters = self.session.execute(
                text("SELECT ST_Area(ST_GeogFromText(:wkt))"), {"wkt": row.boundary_wkt}
            ).scalar_one()

            segment_ids = (
                self.session.execute(
                    select(RoadSegmentModel.id)
                    .join(RoadModel, RoadModel.id == RoadSegmentModel.road_id)
                    .where(
                        RoadModel.import_area_id == import_area_id,
                        or_(
                            func.ST_Covers(boundary_geom, RoadSegmentModel.geom),
                            # A segment crossing the bounding box runs along a clipped
                            # block's boundary without the block covering it.
                            func.ST_Length(
                                func.ST_Intersection(
                                    RoadSegmentModel.geom,
                                    func.ST_Buffer(func.ST_Boundary(boundary_geom), _COLLINEAR_TOLERANCE_DEGREES),
                                )
                            )
                            > _MIN_SHARED_LENGTH_DEGREES,
                        ),
                    )
                    .order_by(
                        func.ST_LineLocatePoint(
                            func.ST_ExteriorRing(boundary_geom),
                            func.ST_StartPoint(RoadSegmentModel.geom),
                        )
                    )
                )
                .scalars()
                .all()
            )
            buildable = self._buildable_area(
                row.boundary_wkt, {segment_id: cross_sections[segment_id].width_meters / 2 for segment_id in segment_ids}
            )

            block_model = BlockModel(
                import_area_id=import_area_id,
                boundary=boundary_geom,
                area_square_meters=area_square_meters,
                buildable_area=buildable.geom,
                buildable_area_square_meters=buildable.area_square_meters,
                is_median=buildable.is_median,
                is_clipped=row.is_clipped,
            )
            self.session.add(block_model)
            self.session.flush()

            for order, segment_id in enumerate(segment_ids):
                self.session.add(
                    BlockBoundarySegmentModel(
                        block_id=block_model.id,
                        road_segment_id=segment_id,
                        sequence_order=order,
                    )
                )
            self.session.flush()

            blocks.append(
                Block(
                    id=block_model.id,
                    import_area_id=import_area_id,
                    boundary=tuple(
                        Coordinate(latitude=y, longitude=x)
                        for x, y in shapely_polygon.exterior.coords
                    ),
                    area_square_meters=area_square_meters,
                    bounding_segment_ids=tuple(segment_ids),
                    buildable_area=geom_to_multipolygon(buildable.geom) if buildable.geom is not None else None,
                    buildable_area_square_meters=buildable.area_square_meters,
                    is_median=buildable.is_median,
                    is_clipped=row.is_clipped,
                )
            )

        return blocks

    def _buildable_area(self, boundary_wkt: str, half_width_by_segment: dict[uuid.UUID, float]) -> "_Buildable":
        """The boundary minus each bounding segment buffered (in meters) by its half-width.

        A median is a result that is empty, or that an inward buffer of half the
        minimum buildable width erases: nowhere is it that wide.
        """
        row = self.session.execute(
            text(
                """
                WITH cut AS (
                    SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference(
                        ST_GeomFromText(:boundary_wkt, 4326),
                        COALESCE(
                            (SELECT ST_Union(ST_Buffer(rs.geom::geography, w.half_width)::geometry)
                             FROM road_segments rs
                             JOIN unnest(CAST(:segment_ids AS uuid[]), CAST(:half_widths AS float8[]))
                                  AS w(id, half_width) ON w.id = rs.id),
                            ST_GeomFromText('POLYGON EMPTY', 4326)
                        )
                    )), 3)) AS geom
                )
                SELECT
                    CASE WHEN ST_IsEmpty(geom) THEN NULL ELSE ST_AsText(geom) END AS wkt,
                    CASE WHEN ST_IsEmpty(geom) THEN 0 ELSE ST_Area(geom::geography) END AS area,
                    ST_IsEmpty(geom)
                        OR ST_IsEmpty(ST_Buffer(geom::geography, -:min_half_width)::geometry) AS is_median
                FROM cut
                """
            ),
            {
                "boundary_wkt": boundary_wkt,
                "segment_ids": [str(segment_id) for segment_id in half_width_by_segment],
                "half_widths": list(half_width_by_segment.values()),
                "min_half_width": MIN_BUILDABLE_WIDTH_METERS / 2,
            },
        ).one()
        geom = from_shape(shapely_wkt.loads(row.wkt), srid=SRID) if row.wkt is not None else None
        return _Buildable(geom=geom, area_square_meters=row.area, is_median=row.is_median)


@dataclass(frozen=True)
class _Buildable:
    geom: object
    area_square_meters: float
    is_median: bool
