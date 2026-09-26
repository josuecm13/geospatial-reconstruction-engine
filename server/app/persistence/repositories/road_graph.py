from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import RoadClassification
from app.domain.geometry import linestring_length_meters
from app.domain.road_graph import NavigableNode, Road, RoadSegment, RoadSegmentWithStreet, Street
from app.persistence.geometry import geom_to_linestring, geom_to_point, linestring_to_geom, point_to_geom
from app.persistence.models import NavigableNodeModel, RoadModel, RoadSegmentModel, StreetModel


class StreetRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, street: Street) -> Street:
        model = self.session.execute(
            select(StreetModel).where(
                StreetModel.import_area_id == street.import_area_id,
                StreetModel.source_id == street.source_id,
            )
        ).scalar_one_or_none()

        if model is None:
            model = StreetModel(
                import_area_id=street.import_area_id,
                source_id=street.source_id,
                name=street.name,
                classification=street.classification,
            )
            self.session.add(model)
        else:
            model.name = street.name
            model.classification = street.classification

        self.session.flush()
        return self._to_domain(model)

    @staticmethod
    def _to_domain(model: StreetModel) -> Street:
        return Street(
            id=model.id,
            import_area_id=model.import_area_id,
            source_id=model.source_id,
            name=model.name,
            classification=RoadClassification(model.classification),
        )


class RoadRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, road: Road) -> Road:
        model = self.session.execute(
            select(RoadModel).where(
                RoadModel.import_area_id == road.import_area_id,
                RoadModel.source_id == road.source_id,
            )
        ).scalar_one_or_none()

        geom = linestring_to_geom(road.geom)
        if model is None:
            model = RoadModel(
                import_area_id=road.import_area_id,
                street_id=road.street_id,
                source_id=road.source_id,
                classification=road.classification,
                geom=geom,
            )
            self.session.add(model)
        else:
            model.street_id = road.street_id
            model.classification = road.classification
            model.geom = geom

        self.session.flush()
        return self._to_domain(model)

    @staticmethod
    def _to_domain(model: RoadModel) -> Road:
        return Road(
            id=model.id,
            import_area_id=model.import_area_id,
            street_id=model.street_id,
            source_id=model.source_id,
            classification=RoadClassification(model.classification),
            geom=geom_to_linestring(model.geom),
        )


class NavigableNodeRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, node: NavigableNode) -> NavigableNode:
        model = self.session.execute(
            select(NavigableNodeModel).where(
                NavigableNodeModel.import_area_id == node.import_area_id,
                NavigableNodeModel.source_id == node.source_id,
            )
        ).scalar_one_or_none()

        geom = point_to_geom(node.point)
        if model is None:
            model = NavigableNodeModel(
                import_area_id=node.import_area_id,
                source_id=node.source_id,
                geom=geom,
            )
            self.session.add(model)
        else:
            model.geom = geom

        self.session.flush()
        return self._to_domain(model)

    def list_for_import_area(self, import_area_id) -> list[NavigableNode]:
        models = self.session.execute(
            select(NavigableNodeModel).where(NavigableNodeModel.import_area_id == import_area_id)
        ).scalars().all()
        return [self._to_domain(model) for model in models]

    @staticmethod
    def _to_domain(model: NavigableNodeModel) -> NavigableNode:
        return NavigableNode(
            id=model.id,
            import_area_id=model.import_area_id,
            source_id=model.source_id,
            point=geom_to_point(model.geom),
        )


class RoadSegmentRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, segment: RoadSegment) -> RoadSegment:
        model = self.session.execute(
            select(RoadSegmentModel).where(
                RoadSegmentModel.road_id == segment.road_id,
                RoadSegmentModel.from_node_id == segment.from_node_id,
                RoadSegmentModel.to_node_id == segment.to_node_id,
            )
        ).scalar_one_or_none()

        geom = linestring_to_geom(segment.geom)
        distance_meters = linestring_length_meters(segment.geom)

        if model is None:
            model = RoadSegmentModel(
                road_id=segment.road_id,
                from_node_id=segment.from_node_id,
                to_node_id=segment.to_node_id,
                geom=geom,
                distance_meters=distance_meters,
                lane_count=segment.lane_count,
                is_vehicle_accessible=segment.is_vehicle_accessible,
            )
            self.session.add(model)
        else:
            model.geom = geom
            model.distance_meters = distance_meters
            model.lane_count = segment.lane_count
            model.is_vehicle_accessible = segment.is_vehicle_accessible

        self.session.flush()
        return self._to_domain(model)

    def list_for_import_area(self, import_area_id) -> list[RoadSegment]:
        models = self.session.execute(
            select(RoadSegmentModel)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .where(RoadModel.import_area_id == import_area_id)
        ).scalars().all()
        return [self._to_domain(model) for model in models]

    def list_for_import_area_with_street(self, import_area_id) -> list[RoadSegmentWithStreet]:
        rows = self.session.execute(
            select(RoadSegmentModel, StreetModel.name, StreetModel.classification)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .join(StreetModel, RoadModel.street_id == StreetModel.id)
            .where(RoadModel.import_area_id == import_area_id)
        ).all()
        return [
            RoadSegmentWithStreet(
                segment=self._to_domain(segment_model),
                street_name=street_name,
                street_classification=RoadClassification(street_classification),
            )
            for segment_model, street_name, street_classification in rows
        ]

    @staticmethod
    def _to_domain(model: RoadSegmentModel) -> RoadSegment:
        return RoadSegment(
            id=model.id,
            road_id=model.road_id,
            from_node_id=model.from_node_id,
            to_node_id=model.to_node_id,
            geom=geom_to_linestring(model.geom),
            distance_meters=model.distance_meters,
            lane_count=model.lane_count,
            is_vehicle_accessible=model.is_vehicle_accessible,
        )
