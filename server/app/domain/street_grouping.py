"""Grouping road ways into logical streets.

A street is a derived entity, like a block: named ways are grouped when their
normalized names match and they are connected (they share a node), or when
they are the two one-way carriageways of a divided road. Unnamed ways stay
single-way streets. A street's id is derived from its import area and its
grouped ways, so an unchanged re-import keeps it.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from app.domain.bounding_box import Coordinate
from app.domain.enums import RoadClassification
from app.domain.geometry import bearing_degrees, point_distance_meters

# Divided-road carriageways: opposite headings, running alongside each other.
DIVIDED_ROAD_MIN_HEADING_DIFFERENCE_DEGREES = 135.0
DIVIDED_ROAD_MAX_GAP_METERS = 30.0

_STREET_ID_NAMESPACE = uuid.UUID("5b0f8a5e-3c2d-4e7a-9f61-7a1c2e9d4b30")

# Most significant first: a street reports the class of its most significant way.
_CLASSIFICATION_RANK = (
    RoadClassification.MOTORWAY,
    RoadClassification.TRUNK,
    RoadClassification.PRIMARY,
    RoadClassification.SECONDARY,
    RoadClassification.TERTIARY,
    RoadClassification.UNCLASSIFIED,
    RoadClassification.RESIDENTIAL,
    RoadClassification.SERVICE,
)


@dataclass(frozen=True)
class GroupableWay:
    """`one_way_direction`: 0 two-way, 1 one-way along `node_ids`, -1 one-way against it."""

    source_id: str
    name: str | None
    classification: RoadClassification
    node_ids: tuple[str, ...]
    points: tuple[Coordinate, ...]
    one_way_direction: int


@dataclass(frozen=True)
class StreetGroup:
    key: str
    name: str | None
    classification: RoadClassification
    way_source_ids: tuple[str, ...]


def normalize_street_name(name: str | None) -> str | None:
    if name is None:
        return None
    normalized = " ".join(name.split()).casefold()
    return normalized or None


def street_id_for(import_area_id: uuid.UUID, group_key: str) -> uuid.UUID:
    return uuid.uuid5(_STREET_ID_NAMESPACE, f"{import_area_id}:{group_key}")


def _travel_heading(way: GroupableWay) -> float:
    start, end = way.points[0], way.points[-1]
    if way.one_way_direction < 0:
        start, end = end, start
    return bearing_degrees(start, end)


def _is_divided_pair(a: GroupableWay, b: GroupableWay) -> bool:
    if a.one_way_direction == 0 or b.one_way_direction == 0:
        return False
    difference = abs(_travel_heading(a) - _travel_heading(b)) % 360.0
    if min(difference, 360.0 - difference) < DIVIDED_ROAD_MIN_HEADING_DIFFERENCE_DEGREES:
        return False
    return any(
        point_distance_meters(p, q) <= DIVIDED_ROAD_MAX_GAP_METERS for p in a.points for q in b.points
    )


def group_ways_into_streets(ways: Sequence[GroupableWay]) -> list[StreetGroup]:
    """Groups, ordered by key; every way belongs to exactly one."""
    parent = list(range(len(ways)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        parent[find(i)] = find(j)

    by_name: dict[str, list[int]] = {}
    for index, way in enumerate(ways):
        name = normalize_street_name(way.name)
        if name is not None:
            by_name.setdefault(name, []).append(index)

    for indices in by_name.values():
        for position, i in enumerate(indices):
            for j in indices[position + 1 :]:
                if set(ways[i].node_ids) & set(ways[j].node_ids) or _is_divided_pair(ways[i], ways[j]):
                    union(i, j)

    members: dict[int, list[GroupableWay]] = {}
    for index, way in enumerate(ways):
        members.setdefault(find(index), []).append(way)

    groups = []
    for group in members.values():
        group = sorted(group, key=lambda way: way.source_id)
        groups.append(
            StreetGroup(
                key="+".join(way.source_id for way in group),
                name=group[0].name,
                classification=min((way.classification for way in group), key=_CLASSIFICATION_RANK.index),
                way_source_ids=tuple(way.source_id for way in group),
            )
        )
    return sorted(groups, key=lambda group: group.key)
