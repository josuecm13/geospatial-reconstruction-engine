import uuid

from geoalchemy2.shape import from_shape
from shapely import wkt as shapely_wkt
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.domain.block import Block
from app.domain.bounding_box import Coordinate
from app.persistence.models import BlockBoundarySegmentModel, BlockModel, RoadModel, RoadSegmentModel

SRID = 4326


class BlockDerivationService:
    """Derives block polygons from an import area's road graph via ST_Polygonize.

    Not sourced from OSM: a block only exists because the enclosing road segments do.
    """

    def __init__(self, session: Session):
        self.session = session

    def derive_for_import_area(self, import_area_id: uuid.UUID) -> list[Block]:
        candidate_rows = self.session.execute(
            text(
                """
                SELECT ST_AsText((ST_Dump(ST_Polygonize(ARRAY[ST_Node(ST_Union(rs.geom))]))).geom)
                    AS boundary_wkt
                FROM road_segments rs
                JOIN roads r ON r.id = rs.road_id
                WHERE r.import_area_id = :import_area_id
                """
            ),
            {"import_area_id": str(import_area_id)},
        ).fetchall()

        blocks: list[Block] = []
        for row in candidate_rows:
            shapely_polygon = shapely_wkt.loads(row.boundary_wkt)
            boundary_geom = from_shape(shapely_polygon, srid=SRID)

            area_square_meters = self.session.execute(
                text("SELECT ST_Area(ST_GeogFromText(:wkt))"), {"wkt": row.boundary_wkt}
            ).scalar_one()

            block_model = BlockModel(
                import_area_id=import_area_id,
                boundary=boundary_geom,
                area_square_meters=area_square_meters,
            )
            self.session.add(block_model)
            self.session.flush()

            segment_ids = (
                self.session.execute(
                    select(RoadSegmentModel.id)
                    .join(RoadModel, RoadModel.id == RoadSegmentModel.road_id)
                    .where(
                        RoadModel.import_area_id == import_area_id,
                        func.ST_Covers(boundary_geom, RoadSegmentModel.geom),
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
                )
            )

        return blocks
