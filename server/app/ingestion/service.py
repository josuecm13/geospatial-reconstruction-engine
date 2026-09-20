from __future__ import annotations

from dataclasses import dataclass, replace

from sqlalchemy.orm import Session

from app.domain.area_feature import AreaFeature
from app.domain.bounding_box import BoundingBox
from app.domain.building import Building
from app.domain.enums import RestrictionKind
from app.domain.import_area import ImportArea
from app.domain.poi import PointOfInterest
from app.domain.road_graph import NavigableNode, Road, RoadSegment, Street
from app.domain.turn_movement import TurnMovement
from app.ingestion.osm_adapter import ImportRecords, OSMFixtureAdapter, OSMIngestionError
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.poi import PointOfInterestRepository
from app.persistence.repositories.road_graph import NavigableNodeRepository, RoadRepository, RoadSegmentRepository, StreetRepository
from app.persistence.repositories.turn_movement import TurnMovementRepository


@dataclass(frozen=True)
class ImportResult:
    import_area: ImportArea
    road_count: int
    node_count: int
    building_count: int
    poi_count: int
    area_feature_count: int


class OSMIngestionService:
    def __init__(self, session: Session, adapter: OSMFixtureAdapter | None = None):
        self.session = session
        self.adapter = adapter or OSMFixtureAdapter()

    def import_fixture(self, bbox: BoundingBox, payload: dict, provider: str = "osm") -> ImportResult:
        area_repo = ImportAreaRepository(self.session)
        import_area = area_repo.get_or_create(provider, bbox)
        # The area identity must survive a failed first import so its failed state
        # can be recorded after rolling back all attempted child writes.
        self.session.commit()
        try:
            area_repo.mark_importing(import_area.id)
            records = self.adapter.parse(payload)
            result = self._persist(import_area, records)
            self.session.commit()
            return result
        except Exception as error:
            self.session.rollback()
            try:
                area_repo = ImportAreaRepository(self.session)
                area_repo.mark_failed(import_area.id)
                self.session.commit()
            except Exception:
                self.session.rollback()
            if isinstance(error, OSMIngestionError):
                raise
            raise OSMIngestionError(f"OSM import failed: {error}") from error

    def _persist(self, import_area: ImportArea, records: ImportRecords) -> ImportResult:
        area_id = import_area.id
        streets = StreetRepository(self.session)
        roads = RoadRepository(self.session)
        nodes = NavigableNodeRepository(self.session)
        segments = RoadSegmentRepository(self.session)

        node_ids = self._navigable_node_ids(records)
        persisted_nodes = {
            source_id: nodes.upsert(NavigableNode(None, area_id, source_id, records.nodes[source_id]))
            for source_id in node_ids
        }
        road_by_source: dict[str, Road] = {}
        segments_by_way: dict[str, list[RoadSegment]] = {}
        for source_road in records.roads:
            street = streets.upsert(Street(None, area_id, source_road.source_id, source_road.name, source_road.classification))
            road = roads.upsert(
                Road(None, area_id, source_road.source_id, source_road.classification,
                     tuple(records.nodes[node_id] for node_id in source_road.node_ids), street.id)
            )
            road_by_source[source_road.source_id] = road
            produced = self._segments_for_road(source_road, road, persisted_nodes, records.nodes, node_ids)
            segments_by_way[source_road.source_id] = [segments.upsert(segment) for segment in produced]

        self._persist_features(area_id, records)
        self._persist_turns(records, segments_by_way, persisted_nodes)
        completed = ImportAreaRepository(self.session).mark_completed(
            area_id,
            road_count=len(records.roads), node_count=len(persisted_nodes), building_count=len(records.buildings),
            poi_count=len(records.pois), area_feature_count=len(records.areas),
        )
        return ImportResult(completed, len(records.roads), len(persisted_nodes), len(records.buildings), len(records.pois), len(records.areas))

    @staticmethod
    def _navigable_node_ids(records: OSMImportRecords) -> set[str]:
        usage: dict[str, int] = {}
        for road in records.roads:
            for node_id in road.node_ids:
                usage[node_id] = usage.get(node_id, 0) + 1
        result = {node_id for node_id, count in usage.items() if count > 1}
        for road in records.roads:
            result.add(road.node_ids[0])
            result.add(road.node_ids[-1])
        result.update(restriction.via_node_id for restriction in records.restrictions)
        return result

    @staticmethod
    def _segments_for_road(source_road, road, persisted_nodes, coordinates, navigable_ids):
        breakpoints = [index for index, node_id in enumerate(source_road.node_ids) if node_id in navigable_ids]
        produced = []
        for start, end in zip(breakpoints, breakpoints[1:]):
            if start == end:
                continue
            path_ids = source_road.node_ids[start : end + 1]
            forward = RoadSegment(None, road.id, persisted_nodes[path_ids[0]].id, persisted_nodes[path_ids[-1]].id,
                                  tuple(coordinates[node_id] for node_id in path_ids), lane_count=source_road.forward_lanes)
            produced.append(forward)
            if source_road.one_way_direction <= 0:
                reversed_ids = tuple(reversed(path_ids))
                produced.append(RoadSegment(None, road.id, persisted_nodes[reversed_ids[0]].id, persisted_nodes[reversed_ids[-1]].id,
                                            tuple(coordinates[node_id] for node_id in reversed_ids), lane_count=source_road.backward_lanes))
            if source_road.one_way_direction < 0:
                produced.pop(0)
        return produced

    def _persist_features(self, area_id, records: OSMImportRecords) -> None:
        buildings = BuildingRepository(self.session)
        pois = PointOfInterestRepository(self.session)
        areas = AreaFeatureRepository(self.session)
        for feature in records.buildings:
            buildings.upsert(Building(None, area_id, feature.source_id, feature.category, tuple(records.nodes[node_id] for node_id in feature.node_ids)))
        for poi in records.pois:
            pois.upsert(PointOfInterest(None, area_id, poi.source_id, poi.category, poi.point, poi.name))
        for feature in records.areas:
            areas.upsert(AreaFeature(None, area_id, feature.source_id, feature.category, tuple(records.nodes[node_id] for node_id in feature.node_ids)))

    def _persist_turns(self, records, segments_by_way, persisted_nodes) -> None:
        repository = TurnMovementRepository(self.session)
        for node in persisted_nodes.values():
            candidates = repository.generate_candidates(node.id)
            if candidates:
                repository.persist_candidates(candidates)
        for restriction in records.restrictions:
            via_id = persisted_nodes[restriction.via_node_id].id
            incoming = [segment for segment in segments_by_way[restriction.from_way_id] if segment.to_node_id == via_id]
            outgoing = [segment for segment in segments_by_way[restriction.to_way_id] if segment.from_node_id == via_id]
            if len(incoming) != 1 or len(outgoing) != 1:
                raise OSMIngestionError(f"restriction {restriction.source_id} cannot resolve exactly one incoming and outgoing segment")
            # Read the currently persisted state, not fresh defaults: a second
            # restriction at the same intersection must build on what an earlier
            # one already persisted, or it would reset it back to allowed.
            candidates = repository.list_for_intersection(via_id)
            target = (incoming[0].id, outgoing[0].id)
            if not any((item.incoming_segment_id, item.outgoing_segment_id) == target for item in candidates):
                raise OSMIngestionError(f"restriction {restriction.source_id} does not match a legal intersection transition")
            adjusted = []
            for candidate in candidates:
                matches = (candidate.incoming_segment_id, candidate.outgoing_segment_id) == target
                is_only = restriction.kind.value.startswith("only_")
                if matches:
                    adjusted.append(replace(candidate, allowed=True, restriction_kind=restriction.kind))
                elif is_only and candidate.incoming_segment_id == incoming[0].id:
                    adjusted.append(replace(candidate, allowed=False, restriction_kind=restriction.kind))
                else:
                    adjusted.append(candidate)
            if not restriction.kind.value.startswith("only_"):
                adjusted = [replace(candidate, allowed=False, restriction_kind=restriction.kind) if (candidate.incoming_segment_id, candidate.outgoing_segment_id) == target else candidate for candidate in adjusted]
            repository.persist_candidates(adjusted)
