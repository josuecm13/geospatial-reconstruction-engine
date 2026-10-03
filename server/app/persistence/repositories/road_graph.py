from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import RoadClassification
from app.domain.geometry import linestring_length_meters
from app.domain.road_graph import NavigableNode, Road, RoadSegment, RoadSegmentWithStreet, Street
from app.persistence.geometry import geom_to_linestring, geom_to_point, linestring_to_geom, point_to_geom
from app.persistence.models import NavigableNodeModel, RoadModel, RoadSegmentModel, StreetModel
from app.persistence.repositories.batching import chunked


class StreetRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, street: Street) -> Street:
        return self.upsert_many(street.import_area_id, [street])[street.source_id]

    def upsert_many(self, import_area_id, items: Iterable[Street]) -> dict[str, Street]:
        """By source id. One SELECT of the existing rows, add or mutate, one flush. Two items with
        the same source id update the same row, as sequential upserts would."""
        items = list(items)
        models: dict[str, StreetModel] = {}
        for source_ids in chunked({item.source_id for item in items}):
            for model in self.session.execute(
                select(StreetModel).where(
                    StreetModel.import_area_id == import_area_id, StreetModel.source_id.in_(source_ids)
                )
            ).scalars():
                models[model.source_id] = model

        for street in items:
            model = models.get(street.source_id)
            if model is None:
                model = StreetModel(
                    id=street.id,
                    import_area_id=street.import_area_id,
                    source_id=street.source_id,
                    name=street.name,
                    classification=street.classification,
                )
                self.session.add(model)
                models[street.source_id] = model
            else:
                model.name = street.name
                model.classification = street.classification

        self.session.flush()
        return {source_id: self._to_domain(model) for source_id, model in models.items()}

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
        return self.upsert_many(road.import_area_id, [road])[road.source_id]

    def upsert_many(self, import_area_id, items: Iterable[Road]) -> dict[str, Road]:
        """By source id. One SELECT of the existing rows, add or mutate, one flush. Two items with
        the same source id update the same row, as sequential upserts would."""
        items = list(items)
        models: dict[str, RoadModel] = {}
        for source_ids in chunked({item.source_id for item in items}):
            for model in self.session.execute(
                select(RoadModel).where(RoadModel.import_area_id == import_area_id, RoadModel.source_id.in_(source_ids))
            ).scalars():
                models[model.source_id] = model

        for road in items:
            geom = linestring_to_geom(road.geom)
            model = models.get(road.source_id)
            if model is None:
                model = RoadModel(
                    import_area_id=road.import_area_id,
                    street_id=road.street_id,
                    source_id=road.source_id,
                    classification=road.classification,
                    geom=geom,
                )
                self.session.add(model)
                models[road.source_id] = model
            else:
                model.street_id = road.street_id
                model.classification = road.classification
                model.geom = geom

        self.session.flush()
        return {source_id: self._to_domain(model) for source_id, model in models.items()}

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
        return self.upsert_many(node.import_area_id, [node])[node.source_id]

    def upsert_many(self, import_area_id, items: Iterable[NavigableNode]) -> dict[str, NavigableNode]:
        """By source id. One SELECT of the existing rows, add or mutate, one flush. Two items with
        the same source id update the same row, as sequential upserts would."""
        items = list(items)
        models: dict[str, NavigableNodeModel] = {}
        for source_ids in chunked({item.source_id for item in items}):
            for model in self.session.execute(
                select(NavigableNodeModel).where(
                    NavigableNodeModel.import_area_id == import_area_id, NavigableNodeModel.source_id.in_(source_ids)
                )
            ).scalars():
                models[model.source_id] = model

        for node in items:
            geom = point_to_geom(node.point)
            model = models.get(node.source_id)
            if model is None:
                model = NavigableNodeModel(import_area_id=node.import_area_id, source_id=node.source_id, geom=geom)
                self.session.add(model)
                models[node.source_id] = model
            else:
                model.geom = geom

        self.session.flush()
        return {source_id: self._to_domain(model) for source_id, model in models.items()}

    def get(self, node_id) -> NavigableNode | None:
        model = self.session.get(NavigableNodeModel, node_id)
        return self._to_domain(model) if model is not None else None

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
        return self.upsert_many([segment])[0]

    def upsert_many(self, items: Iterable[RoadSegment]) -> list[RoadSegment]:
        """Keyed on (road, from node, to node). One SELECT of the existing rows of the batch's
        roads, add or mutate, one flush. Returns one segment per input, in input order; two items
        with the same key update the same row, as sequential upserts would."""
        items = list(items)
        models: dict[tuple, RoadSegmentModel] = {}
        for road_ids in chunked({item.road_id for item in items}):
            for model in self.session.execute(
                select(RoadSegmentModel).where(RoadSegmentModel.road_id.in_(road_ids))
            ).scalars():
                models[(model.road_id, model.from_node_id, model.to_node_id)] = model

        keys = []
        for segment in items:
            key = (segment.road_id, segment.from_node_id, segment.to_node_id)
            keys.append(key)
            geom = linestring_to_geom(segment.geom)
            distance_meters = linestring_length_meters(segment.geom)
            model = models.get(key)
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
                models[key] = model
            else:
                model.geom = geom
                model.distance_meters = distance_meters
                model.lane_count = segment.lane_count
                model.is_vehicle_accessible = segment.is_vehicle_accessible

        self.session.flush()
        return [self._to_domain(models[key]) for key in keys]

    def list_for_import_area(self, import_area_id) -> list[RoadSegment]:
        models = self.session.execute(
            select(RoadSegmentModel)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .where(RoadModel.import_area_id == import_area_id)
        ).scalars().all()
        return [self._to_domain(model) for model in models]

    def list_for_import_area_with_street(self, import_area_id) -> list[RoadSegmentWithStreet]:
        rows = self.session.execute(
            select(RoadSegmentModel, StreetModel.id, StreetModel.name, StreetModel.classification, RoadModel.classification)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .join(StreetModel, RoadModel.street_id == StreetModel.id)
            .where(RoadModel.import_area_id == import_area_id)
        ).all()
        return [
            RoadSegmentWithStreet(
                segment=self._to_domain(segment_model),
                street_name=street_name,
                street_classification=RoadClassification(street_classification),
                road_classification=RoadClassification(road_classification),
                street_id=street_id,
            )
            for segment_model, street_id, street_name, street_classification, road_classification in rows
        ]

    def list_for_import_area_with_road_classification(
        self, import_area_id
    ) -> list[tuple[RoadSegment, RoadClassification]]:
        """Every segment of the area with its road's classification, whether or not the road has a street."""
        rows = self.session.execute(
            select(RoadSegmentModel, RoadModel.classification)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .where(RoadModel.import_area_id == import_area_id)
        ).all()
        return [(self._to_domain(model), RoadClassification(classification)) for model, classification in rows]

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
