"""Translation of a deliberately small Overpass-style OSM payload into import records."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

from app.domain.bounding_box import Coordinate
from app.domain.enums import AreaFeatureKind, BuildingCategory, PoiCategory, RoadClassification, RestrictionKind


class IngestionError(ValueError):
    """A supported OSM feature cannot safely be translated."""


class PayloadOutsideBoundingBox(IngestionError):
    """A supported feature in the payload does not belong to the declared bounding box."""

    def __init__(self, message: str, source_ids: list[str]):
        super().__init__(message)
        self.source_ids = source_ids


@dataclass(frozen=True)
class ImportRoad:
    source_id: str
    node_ids: tuple[str, ...]
    classification: RoadClassification
    name: str | None
    one_way_direction: int
    forward_lanes: int | None
    backward_lanes: int | None


@dataclass(frozen=True)
class ImportPolygonFeature:
    source_id: str
    node_ids: tuple[str, ...]
    category: BuildingCategory | AreaFeatureKind


@dataclass(frozen=True)
class ImportBuilding:
    source_id: str
    node_ids: tuple[str, ...]
    category: BuildingCategory
    height_meters: float | None
    levels: int | None


@dataclass(frozen=True)
class ImportPoi:
    source_id: str
    point: Coordinate
    category: PoiCategory
    name: str | None


@dataclass(frozen=True)
class ImportTurnRestriction:
    source_id: str
    from_way_id: str
    via_node_id: str
    to_way_id: str
    kind: RestrictionKind


@dataclass(frozen=True)
class ImportRecords:
    nodes: dict[str, Coordinate]
    roads: tuple[ImportRoad, ...]
    buildings: tuple[ImportBuilding, ...]
    pois: tuple[ImportPoi, ...]
    areas: tuple[ImportPolygonFeature, ...]
    restrictions: tuple[ImportTurnRestriction, ...]


# Kept as aliases for callers which adopted the initial adapter module before
# the records were made explicitly provider-neutral.
OSMIngestionError = IngestionError
OSMRoad = ImportRoad
OSMPolygonFeature = ImportPolygonFeature
OSMBuilding = ImportBuilding
OSMPoi = ImportPoi
OSMTurnRestriction = ImportTurnRestriction
OSMImportRecords = ImportRecords


_ROAD_CLASSES = {
    **{item.value: item for item in RoadClassification},
    # A link (ramp or slip road) takes its parent road's class, so it keeps the network connected
    # and gets that class's generated cross-section.
    **{f"{item.value}_link": item for item in (
        RoadClassification.MOTORWAY,
        RoadClassification.TRUNK,
        RoadClassification.PRIMARY,
        RoadClassification.SECONDARY,
        RoadClassification.TERTIARY,
    )},
    # A shared street is drivable and residential in character.
    "living_street": RoadClassification.RESIDENTIAL,
}
_RESTRICTIONS = {item.value: item for item in RestrictionKind if item is not RestrictionKind.NONE}
# Vehicle-scoped restriction keys that bind a car, most specific first. Any other
# `restriction:<vehicle>` (bus, hgv, bicycle, …) doesn't apply to car routing and is skipped.
_CAR_RESTRICTION_KEYS = ("restriction:motorcar", "restriction:motor_vehicle", "restriction:vehicle")


def _source_id(element: dict[str, Any]) -> str:
    identifier = element.get("id")
    if identifier is None:
        raise IngestionError("supported OSM element is missing id")
    return str(identifier)


def _lane_count(value: Any, element_id: str, key: str) -> int | None:
    if value is None:
        return None
    try:
        count = int(str(value))
    except (TypeError, ValueError):
        return None
    if count < 1:
        raise IngestionError(f"way {element_id} has invalid {key} lane count")
    return count


_METERS_PER_FOOT = 0.3048
_HEIGHT_METERS = re.compile(r"(\d+(?:\.\d+)?)\s*(?:m)?")
_HEIGHT_FEET = re.compile(r"(\d+(?:\.\d+)?)\s*(?:'|ft|feet)")


def _height_meters(value: Any) -> float | None:
    """A source height in meters, or None when it is missing or not a usable number.

    Unknown stays unknown: this never raises and never substitutes a default."""
    if value is None:
        return None
    text = str(value).strip().lower().replace(",", ".")
    if match := _HEIGHT_METERS.fullmatch(text):
        height = float(match.group(1))
    elif match := _HEIGHT_FEET.fullmatch(text):
        height = float(match.group(1)) * _METERS_PER_FOOT
    else:
        return None
    return height if math.isfinite(height) and height > 0 else None


def _levels(value: Any) -> int | None:
    """A source level count, or None unless it is a whole non-negative number."""
    if value is None:
        return None
    try:
        levels = float(str(value).strip())
    except ValueError:
        return None
    if not math.isfinite(levels) or levels < 0 or not levels.is_integer():
        return None
    return int(levels)


def _polygon_nodes(element: dict[str, Any]) -> tuple[str, ...]:
    nodes = tuple(str(node_id) for node_id in element.get("nodes", []))
    if len(nodes) < 4 or nodes[0] != nodes[-1]:
        raise IngestionError(f"way {_source_id(element)} must be a closed polygon")
    if len(set(nodes[:-1])) < 3:
        raise IngestionError(f"way {_source_id(element)} must have three distinct polygon vertices")
    return nodes


def _one_way_direction(value: Any, element_id: str) -> int:
    normalized = str(value or "").strip().lower()
    # reversible (direction switches by time of day) and alternating (both directions share one
    # lane in turns) are each legal in both directions at some time, so a static graph keeps both.
    if normalized in {"", "no", "0", "false", "reversible", "alternating"}:
        return 0
    if normalized in {"yes", "1", "true"}:
        return 1
    if normalized == "-1":
        return -1
    raise IngestionError(f"road way {element_id} has unsupported oneway value {value!r}")


def _polygon_center(node_ids: tuple[str, ...], nodes: dict[str, Coordinate]) -> Coordinate:
    """Return a stable representative point for a supported POI-area way."""
    try:
        vertices = [nodes[node_id] for node_id in node_ids[:-1]]
        return Coordinate(
            sum(vertex.latitude for vertex in vertices) / len(vertices),
            sum(vertex.longitude for vertex in vertices) / len(vertices),
        )
    except KeyError as error:
        raise IngestionError(f"feature references missing node {error.args[0]}") from error


def _split_lanes(tags: dict[str, Any], source_id: str, is_one_way: bool) -> tuple[int | None, int | None]:
    forward_raw = tags.get("lanes:forward")
    backward_raw = tags.get("lanes:backward")
    total_raw = tags.get("lanes")

    if is_one_way:
        forward_lanes = _lane_count(forward_raw or total_raw, source_id, "lanes")
        backward_lanes = _lane_count(backward_raw or total_raw, source_id, "lanes")
        return forward_lanes, backward_lanes

    forward_tagged = _lane_count(forward_raw, source_id, "lanes:forward")
    backward_tagged = _lane_count(backward_raw, source_id, "lanes:backward")
    total = _lane_count(total_raw, source_id, "lanes")

    if forward_tagged is not None and backward_tagged is not None:
        return forward_tagged, backward_tagged

    if forward_tagged is not None:
        if total is not None:
            remainder = total - forward_tagged
            backward_lanes = remainder if remainder >= 1 else None
            return forward_tagged, backward_lanes
        return forward_tagged, None

    if backward_tagged is not None:
        if total is not None:
            remainder = total - backward_tagged
            forward_lanes = remainder if remainder >= 1 else None
            return forward_lanes, backward_tagged
        return None, backward_tagged

    if total is not None:
        backward_lanes = total // 2
        forward_lanes = total - backward_lanes
        return forward_lanes, backward_lanes if backward_lanes >= 1 else None

    return None, None


class OSMFixtureAdapter:
    """Maps a JSON-compatible Overpass payload to application-owned import records."""

    def parse(self, payload: dict[str, Any]) -> ImportRecords:
        elements = payload.get("elements")
        if not isinstance(elements, list):
            raise IngestionError("OSM fixture must contain an elements list")

        nodes: dict[str, Coordinate] = {}
        ways: list[dict[str, Any]] = []
        relations: list[dict[str, Any]] = []
        for element in elements:
            if not isinstance(element, dict):
                continue
            element_type = element.get("type")
            if element_type == "node":
                if "lat" not in element or "lon" not in element:
                    if element.get("tags"):
                        raise IngestionError(f"node {_source_id(element)} is missing coordinates")
                    continue
                try:
                    nodes[_source_id(element)] = Coordinate(float(element["lat"]), float(element["lon"]))
                except (TypeError, ValueError) as error:
                    raise IngestionError(f"node {_source_id(element)} has invalid coordinates") from error
            elif element_type == "way":
                ways.append(element)
            elif element_type == "relation":
                relations.append(element)

        roads: list[ImportRoad] = []
        buildings: list[ImportBuilding] = []
        areas: list[ImportPolygonFeature] = []
        pois: list[ImportPoi] = []

        for element in ways:
            tags = element.get("tags", {})
            if not isinstance(tags, dict):
                continue
            source_id = _source_id(element)
            highway = tags.get("highway")
            if highway in _ROAD_CLASSES:
                node_ids = tuple(str(node_id) for node_id in element.get("nodes", []))
                if len(node_ids) < 2:
                    raise IngestionError(f"road way {source_id} needs at least two nodes")
                oneway = tags.get("oneway")
                if oneway is None and tags.get("junction") == "roundabout":
                    # OSM implies oneway=yes, in the drawn direction, on a roundabout.
                    oneway = "yes"
                one_way_direction = _one_way_direction(oneway, source_id)
                forward_lanes, backward_lanes = _split_lanes(tags, source_id, one_way_direction != 0)
                roads.append(
                    ImportRoad(
                        source_id=source_id,
                        node_ids=node_ids,
                        classification=_ROAD_CLASSES[highway],
                        name=tags.get("name"),
                        one_way_direction=one_way_direction,
                        forward_lanes=forward_lanes,
                        backward_lanes=backward_lanes,
                    )
                )
                continue
            if "building" in tags:
                buildings.append(
                    ImportBuilding(
                        source_id,
                        _polygon_nodes(element),
                        _building_category(tags["building"]),
                        _height_meters(tags.get("height")),
                        _levels(tags.get("building:levels")),
                    )
                )
                continue
            poi_category = _poi_category(tags)
            if poi_category is not None:
                polygon_nodes = _polygon_nodes(element)
                pois.append(ImportPoi(source_id, _polygon_center(polygon_nodes, nodes), poi_category, tags.get("name")))
                continue
            kind = _area_kind(tags)
            if kind is not None:
                areas.append(ImportPolygonFeature(source_id, _polygon_nodes(element), kind))

        for element in elements:
            if not isinstance(element, dict) or element.get("type") != "node":
                continue
            tags = element.get("tags", {})
            category = _poi_category(tags) if isinstance(tags, dict) else None
            if category is not None:
                source_id = _source_id(element)
                point = nodes.get(source_id)
                if point is None:
                    raise IngestionError(f"POI node {source_id} is missing coordinates")
                pois.append(ImportPoi(source_id, point, category, tags.get("name")))

        ways_by_id = {_source_id(way): way for way in ways}
        for relation in relations:
            self._multipolygon_features(relation, ways_by_id, nodes, buildings, areas)

        restrictions = tuple(
            restriction
            for relation in relations
            if self._is_restriction(relation)
            if (restriction := self._restriction(relation)) is not None
        )
        self._validate_references(nodes, roads, buildings, areas, restrictions)
        return ImportRecords(nodes, tuple(roads), tuple(buildings), tuple(pois), tuple(areas), restrictions)

    @staticmethod
    def _multipolygon_features(relation, ways_by_id, nodes, buildings, areas) -> None:
        """Adds one building or area feature per closed outer ring of a multipolygon relation.

        The domain polygon has no holes, so inner rings are ignored. A ring's vertices get
        synthetic node ids (`relation/<id>[/<ring>]#<i>`), since Overpass gives a member's
        geometry without its node ids. They're never navigable. Rings that can't be closed
        (an incomplete relation) are skipped rather than failing the import."""
        tags = relation.get("tags", {})
        if not isinstance(tags, dict) or tags.get("type") != "multipolygon":
            return
        kind = None if "building" in tags else _area_kind(tags)
        if "building" not in tags and kind is None:
            return
        rings = _outer_rings(relation, ways_by_id, nodes)
        relation_id = _source_id(relation)
        for index, ring in enumerate(rings):
            source_id = f"relation/{relation_id}" if len(rings) == 1 else f"relation/{relation_id}/{index}"
            node_ids = []
            for vertex_index, point in enumerate(ring[:-1]):
                node_id = f"{source_id}#{vertex_index}"
                nodes[node_id] = point
                node_ids.append(node_id)
            node_ids.append(node_ids[0])
            if kind is None:
                buildings.append(
                    ImportBuilding(
                        source_id,
                        tuple(node_ids),
                        _building_category(tags["building"]),
                        _height_meters(tags.get("height")),
                        _levels(tags.get("building:levels")),
                    )
                )
            else:
                areas.append(ImportPolygonFeature(source_id, tuple(node_ids), kind))

    @staticmethod
    def _is_restriction(relation: dict[str, Any]) -> bool:
        tags = relation.get("tags", {})
        return isinstance(tags, dict) and tags.get("type") == "restriction"

    def _restriction(self, relation: dict[str, Any]) -> ImportTurnRestriction | None:
        """The relation as a car-routing restriction, or None when it applies only to other vehicles."""
        source_id = _source_id(relation)
        tags = relation.get("tags", {})
        value = tags.get("restriction")
        if value is None:
            value = next((tags[key] for key in _CAR_RESTRICTION_KEYS if key in tags), None)
            if value is None:
                if any(str(key).startswith("restriction:") for key in tags):
                    return None
                raise IngestionError(f"restriction relation {source_id} has unsupported restriction")
        kind = _RESTRICTIONS.get(value)
        if kind is None:
            raise IngestionError(f"restriction relation {source_id} has unsupported restriction")
        members = relation.get("members", [])
        expected_types = {"from": "way", "via": "node", "to": "way"}
        found = {
            role: str(member.get("ref"))
            for member in members
            if isinstance(member, dict)
            for role, expected_type in expected_types.items()
            if member.get("role") == role and member.get("type") == expected_type and member.get("ref") is not None
        }
        if set(found) != set(expected_types):
            raise IngestionError(f"restriction relation {source_id} needs from, via, and to members")
        return ImportTurnRestriction(source_id, found["from"], found["via"], found["to"], kind)

    @staticmethod
    def _validate_references(nodes, roads, buildings, areas, restrictions) -> None:
        road_ids = {road.source_id for road in roads}
        for feature in [*roads, *buildings, *areas]:
            for node_id in feature.node_ids:
                if node_id not in nodes:
                    raise IngestionError(f"feature {feature.source_id} references missing node {node_id}")
        for restriction in restrictions:
            if restriction.from_way_id not in road_ids or restriction.to_way_id not in road_ids:
                raise IngestionError(f"restriction {restriction.source_id} references an unsupported or missing road way")
            if restriction.via_node_id not in nodes:
                raise IngestionError(f"restriction {restriction.source_id} references missing via node {restriction.via_node_id}")


def _member_points(member: dict[str, Any], ways_by_id, nodes: dict[str, Coordinate]) -> list[Coordinate] | None:
    """A way member's points: its inline geometry (`out geom`), else its way element's nodes."""
    geometry = member.get("geometry")
    if isinstance(geometry, list) and geometry:
        if not all(isinstance(point, dict) and "lat" in point and "lon" in point for point in geometry):
            return None
        return [Coordinate(float(point["lat"]), float(point["lon"])) for point in geometry]
    way = ways_by_id.get(str(member.get("ref")))
    if way is None:
        return None
    node_ids = [str(node_id) for node_id in way.get("nodes", [])]
    if not node_ids or any(node_id not in nodes for node_id in node_ids):
        return None
    return [nodes[node_id] for node_id in node_ids]


def _outer_rings(relation: dict[str, Any], ways_by_id, nodes: dict[str, Coordinate]) -> list[list[Coordinate]]:
    """Joins a multipolygon's outer members end to end into closed rings of ≥ 3 distinct points."""
    pieces = []
    for member in relation.get("members", []):
        if not isinstance(member, dict) or member.get("type") != "way" or member.get("role") not in ("outer", ""):
            continue
        points = _member_points(member, ways_by_id, nodes)
        if points is not None and len(points) >= 2:
            pieces.append(points)
    rings = []
    while pieces:
        ring = list(pieces.pop(0))
        while ring[0] != ring[-1]:
            for index, piece in enumerate(pieces):
                if piece[0] == ring[-1]:
                    ring.extend(piece[1:])
                elif piece[-1] == ring[-1]:
                    ring.extend(reversed(piece[:-1]))
                else:
                    continue
                pieces.pop(index)
                break
            else:
                break
        if ring[0] == ring[-1] and len(set(ring[:-1])) >= 3:
            rings.append(ring)
    return rings


def _building_category(value: str) -> BuildingCategory:
    if value in {"commercial", "retail"}:
        return BuildingCategory.COMMERCIAL
    if value in {"industrial", "warehouse"}:
        return BuildingCategory.INDUSTRIAL
    if value in {"civic", "school", "church", "hospital"}:
        return BuildingCategory.CIVIC
    if value in {"yes", "house", "apartments", "residential"}:
        return BuildingCategory.RESIDENTIAL
    return BuildingCategory.UNSPECIFIED


def _poi_category(tags: dict[str, Any]) -> PoiCategory | None:
    if "amenity" not in tags and "shop" not in tags:
        return None
    value = tags.get("amenity") or tags.get("shop")
    if value in {"restaurant", "cafe", "bar"}:
        return PoiCategory.FOOD_AND_DRINK
    if value in {"hospital", "clinic", "pharmacy"}:
        return PoiCategory.HEALTH
    if value in {"school", "college", "kindergarten"}:
        return PoiCategory.EDUCATION
    if value in {"bus_station", "parking", "fuel"}:
        return PoiCategory.TRANSIT
    if "shop" in tags:
        return PoiCategory.SHOPPING
    return PoiCategory.OTHER


def _area_kind(tags: dict[str, Any]) -> AreaFeatureKind | None:
    if tags.get("leisure") == "park":
        return AreaFeatureKind.PARK
    if tags.get("natural") == "water":
        return AreaFeatureKind.WATER
    if tags.get("landuse") in {"grass", "recreation_ground"}:
        return AreaFeatureKind.GREEN_SPACE
    return None
