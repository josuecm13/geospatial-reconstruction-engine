from __future__ import annotations

from dataclasses import dataclass, replace

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.domain.area_feature import AreaFeature
from app.domain.bounding_box import BoundingBox
from app.domain.building import Building
from app.domain.enums import RestrictionKind
from app.domain.import_area import ImportArea
from app.domain.poi import PointOfInterest
from app.domain.road_graph import NavigableNode, Road, RoadSegment, Street
from app.domain.street_grouping import GroupableWay, group_ways_into_streets, street_id_for
from app.domain.turn_movement import TurnMovement
from app.ingestion.osm_adapter import ImportRecords, OSMFixtureAdapter, OSMIngestionError, PayloadOutsideBoundingBox
from app.ingestion.overpass import ensure_complete, with_way_nodes_from_geometry
from app.persistence.block_derivation import BlockDerivationService
from app.persistence.models import (
    AreaFeatureModel,
    BuildingModel,
    NavigableNodeModel,
    PointOfInterestModel,
    RoadModel,
    RoadSegmentModel,
    StreetModel,
    TurnMovementModel,
)
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
    block_count: int = 0
    linked_building_count: int = 0
    created_count: int = 0
    updated_count: int = 0
    removed_count: int = 0


class OSMIngestionService:
    def __init__(self, session: Session, adapter: OSMFixtureAdapter | None = None):
        self.session = session
        self.adapter = adapter or OSMFixtureAdapter()

    def import_fixture(self, bbox: BoundingBox, payload: dict, provider: str = "osm") -> ImportResult:
        # Before the area is created or marked importing: an incomplete response must leave the
        # area exactly as it was, not even recorded as failed.
        ensure_complete(payload)
        area_repo = ImportAreaRepository(self.session)
        import_area = area_repo.get_or_create(provider, bbox)
        # The area identity must survive a failed first import so its failed state
        # can be recorded after rolling back all attempted child writes.
        self.session.commit()
        try:
            area_repo.mark_importing(import_area.id)
            records = self.adapter.parse(with_way_nodes_from_geometry(payload))
            self._validate_within_bounding_box(bbox, records)
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

        # 0. Snapshot ids that already exist for this area, before any upsert
        #    runs, so created/updated/removed can be computed by diffing
        #    against what each upsert loop touches below.
        existing_node_ids_before = set(
            self.session.scalars(select(NavigableNodeModel.id).where(NavigableNodeModel.import_area_id == area_id)).all()
        )
        existing_road_ids_before = set(
            self.session.scalars(select(RoadModel.id).where(RoadModel.import_area_id == area_id)).all()
        )
        existing_street_ids_before = set(
            self.session.scalars(select(StreetModel.id).where(StreetModel.import_area_id == area_id)).all()
        )
        existing_segment_ids_before = set(
            self.session.scalars(
                select(RoadSegmentModel.id)
                .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
                .where(RoadModel.import_area_id == area_id)
            ).all()
        )
        existing_building_ids_before = set(
            self.session.scalars(select(BuildingModel.id).where(BuildingModel.import_area_id == area_id)).all()
        )
        existing_poi_ids_before = set(
            self.session.scalars(select(PointOfInterestModel.id).where(PointOfInterestModel.import_area_id == area_id)).all()
        )
        existing_area_feature_ids_before = set(
            self.session.scalars(select(AreaFeatureModel.id).where(AreaFeatureModel.import_area_id == area_id)).all()
        )

        # 1. Upsert every source entity, tracking which rows this payload
        #    touched — anything for this area *not* in these sets is stale
        #    from a previous import and gets swept below.
        node_ids = self._navigable_node_ids(records)
        persisted_nodes = {
            source_id: nodes.upsert(NavigableNode(None, area_id, source_id, records.nodes[source_id]))
            for source_id in node_ids
        }
        touched_node_ids = {node.id for node in persisted_nodes.values()}

        touched_street_ids: set = set()
        touched_road_ids: set = set()
        touched_segment_ids: set = set()
        segments_by_way: dict[str, list[RoadSegment]] = {}
        street_by_way = self._persist_streets(streets, area_id, records)
        touched_street_ids.update(street.id for street in street_by_way.values())
        for source_road in records.roads:
            street = street_by_way[source_road.source_id]
            road = roads.upsert(
                Road(None, area_id, source_road.source_id, source_road.classification,
                     tuple(records.nodes[node_id] for node_id in source_road.node_ids), street.id)
            )
            touched_road_ids.add(road.id)
            produced = self._segments_for_road(source_road, road, persisted_nodes, records.nodes, node_ids)
            persisted_segments = [segments.upsert(segment) for segment in produced]
            segments_by_way[source_road.source_id] = persisted_segments
            touched_segment_ids.update(segment.id for segment in persisted_segments)

        touched_building_ids, touched_poi_ids, touched_area_feature_ids = self._persist_features(area_id, records)

        # 2. Reset derived block data *before* sweeping stale segments: blocks
        #    and block_boundary_segments reference segments, and no foreign
        #    key here cascades, so a stale segment can't be deleted while a
        #    block still points at it.
        block_service = BlockDerivationService(self.session)
        block_service.clear_for_import_area(area_id)

        # 3-4. Sweep every row this payload no longer produces, children first.
        self._sweep(
            area_id,
            touched_segment_ids=touched_segment_ids,
            touched_road_ids=touched_road_ids,
            touched_street_ids=touched_street_ids,
            touched_node_ids=touched_node_ids,
            touched_building_ids=touched_building_ids,
            touched_poi_ids=touched_poi_ids,
            touched_area_feature_ids=touched_area_feature_ids,
        )

        # 5. Turn candidates/restrictions, generated only over the now-reconciled segments.
        self._persist_turns(records, segments_by_way, persisted_nodes)

        # 6. Derive fresh blocks and link buildings over the reconciled network.
        blocks = block_service.derive_for_import_area(area_id)
        linked_building_count = BuildingRepository(self.session).link_to_containing_block(area_id)

        # 7. Counts are read back from storage, so they always equal what map data returns.
        counts = self._counts_for_area(area_id)
        completed = ImportAreaRepository(self.session).mark_completed(area_id, **counts)

        # 8. Created/updated/removed, aggregated across every reconciled table,
        #    diffed against the pre-upsert snapshot taken in step 0.
        reconciled = (
            (existing_node_ids_before, touched_node_ids),
            (existing_street_ids_before, touched_street_ids),
            (existing_road_ids_before, touched_road_ids),
            (existing_segment_ids_before, touched_segment_ids),
            (existing_building_ids_before, touched_building_ids),
            (existing_poi_ids_before, touched_poi_ids),
            (existing_area_feature_ids_before, touched_area_feature_ids),
        )
        created_count = sum(len(touched - existing) for existing, touched in reconciled)
        updated_count = sum(len(touched & existing) for existing, touched in reconciled)
        removed_count = sum(len(existing - touched) for existing, touched in reconciled)

        return ImportResult(
            import_area=completed,
            block_count=len(blocks),
            linked_building_count=linked_building_count,
            created_count=created_count,
            updated_count=updated_count,
            removed_count=removed_count,
            **counts,
        )

    def _sweep(
        self,
        area_id,
        *,
        touched_segment_ids: set,
        touched_road_ids: set,
        touched_street_ids: set,
        touched_node_ids: set,
        touched_building_ids: set,
        touched_poi_ids: set,
        touched_area_feature_ids: set,
    ) -> None:
        session = self.session

        stale_segment_ids = session.execute(
            select(RoadSegmentModel.id)
            .join(RoadModel, RoadSegmentModel.road_id == RoadModel.id)
            .where(RoadModel.import_area_id == area_id, RoadSegmentModel.id.notin_(touched_segment_ids))
        ).scalars().all()

        if stale_segment_ids:
            session.execute(
                delete(TurnMovementModel).where(
                    or_(
                        TurnMovementModel.incoming_segment_id.in_(stale_segment_ids),
                        TurnMovementModel.outgoing_segment_id.in_(stale_segment_ids),
                    )
                )
            )
            session.execute(delete(RoadSegmentModel).where(RoadSegmentModel.id.in_(stale_segment_ids)))

        session.execute(
            delete(RoadModel).where(RoadModel.import_area_id == area_id, RoadModel.id.notin_(touched_road_ids))
        )
        session.execute(
            delete(StreetModel).where(StreetModel.import_area_id == area_id, StreetModel.id.notin_(touched_street_ids))
        )
        session.execute(
            delete(NavigableNodeModel).where(
                NavigableNodeModel.import_area_id == area_id, NavigableNodeModel.id.notin_(touched_node_ids)
            )
        )
        session.execute(
            delete(BuildingModel).where(
                BuildingModel.import_area_id == area_id, BuildingModel.id.notin_(touched_building_ids)
            )
        )
        session.execute(
            delete(PointOfInterestModel).where(
                PointOfInterestModel.import_area_id == area_id, PointOfInterestModel.id.notin_(touched_poi_ids)
            )
        )
        session.execute(
            delete(AreaFeatureModel).where(
                AreaFeatureModel.import_area_id == area_id,
                AreaFeatureModel.id.notin_(touched_area_feature_ids),
            )
        )
        session.flush()

    def _counts_for_area(self, area_id) -> dict[str, int]:
        session = self.session

        def count(model) -> int:
            return session.scalar(select(func.count()).select_from(model).where(model.import_area_id == area_id))

        return {
            "road_count": count(RoadModel),
            "node_count": count(NavigableNodeModel),
            "building_count": count(BuildingModel),
            "poi_count": count(PointOfInterestModel),
            "area_feature_count": count(AreaFeatureModel),
        }

    @staticmethod
    def _validate_within_bounding_box(bbox: BoundingBox, records: ImportRecords) -> None:
        """Reject a payload with features outside the declared bounding box.

        A road, building, area feature, or POI mapped as an area is accepted if its
        coordinate envelope *intersects* the box (real ways legitimately cross the
        edge, and an area POI's center may fall outside); a POI mapped as a node
        must lie inside it, since a point has no edge to cross.
        """
        offending: list[str] = []

        def envelope_intersects(node_ids: tuple[str, ...]) -> bool:
            lats = [records.nodes[node_id].latitude for node_id in node_ids]
            lons = [records.nodes[node_id].longitude for node_id in node_ids]
            return not (
                max(lats) < bbox.min_corner.latitude
                or min(lats) > bbox.max_corner.latitude
                or max(lons) < bbox.min_corner.longitude
                or min(lons) > bbox.max_corner.longitude
            )

        for road in records.roads:
            if not envelope_intersects(road.node_ids):
                offending.append(road.source_id)
        for feature in (*records.buildings, *records.areas):
            if not envelope_intersects(feature.node_ids):
                offending.append(feature.source_id)
        for poi in records.pois:
            if poi.footprint_node_ids:
                if not envelope_intersects(poi.footprint_node_ids):
                    offending.append(poi.source_id)
                continue
            point = poi.point
            inside = (
                bbox.min_corner.latitude <= point.latitude <= bbox.max_corner.latitude
                and bbox.min_corner.longitude <= point.longitude <= bbox.max_corner.longitude
            )
            if not inside:
                offending.append(poi.source_id)

        if offending:
            raise PayloadOutsideBoundingBox(
                "payload contains features outside the import bounding box: "
                + ", ".join(offending[:10]),
                source_ids=offending,
            )

    @staticmethod
    def _navigable_node_ids(records: ImportRecords) -> set[str]:
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
    def _persist_streets(streets: StreetRepository, area_id, records: ImportRecords) -> dict[str, Street]:
        """Upsert one logical street per group of ways; return each way's street."""
        groups = group_ways_into_streets([
            GroupableWay(road.source_id, road.name, road.classification, road.node_ids,
                         tuple(records.nodes[node_id] for node_id in road.node_ids), road.one_way_direction)
            for road in records.roads
        ])
        street_by_way: dict[str, Street] = {}
        for group in groups:
            street = streets.upsert(
                Street(street_id_for(area_id, group.key), area_id, group.key, group.name, group.classification)
            )
            street_by_way.update({source_id: street for source_id in group.way_source_ids})
        return street_by_way

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

    def _persist_features(self, area_id, records: ImportRecords) -> tuple[set, set, set]:
        buildings = BuildingRepository(self.session)
        pois = PointOfInterestRepository(self.session)
        areas = AreaFeatureRepository(self.session)
        touched_building_ids: set = set()
        touched_poi_ids: set = set()
        touched_area_feature_ids: set = set()
        for feature in records.buildings:
            persisted = buildings.upsert(
                Building(
                    None,
                    area_id,
                    feature.source_id,
                    feature.category,
                    tuple(records.nodes[node_id] for node_id in feature.node_ids),
                    height_meters=feature.height_meters,
                    levels=feature.levels,
                )
            )
            touched_building_ids.add(persisted.id)
        for poi in records.pois:
            persisted = pois.upsert(PointOfInterest(None, area_id, poi.source_id, poi.category, poi.point, poi.name))
            touched_poi_ids.add(persisted.id)
        for feature in records.areas:
            persisted = areas.upsert(
                AreaFeature(None, area_id, feature.source_id, feature.category, tuple(records.nodes[node_id] for node_id in feature.node_ids))
            )
            touched_area_feature_ids.add(persisted.id)
        return touched_building_ids, touched_poi_ids, touched_area_feature_ids

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
