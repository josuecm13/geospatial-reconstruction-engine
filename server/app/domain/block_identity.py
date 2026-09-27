"""Deterministic block ids, derived from each block's bounding-segment set.

Segment ids survive a re-import that doesn't change them (segments reconcile
by road and endpoints), so a block bounded by the same segments comes back
under the same id, and a changed road changes only the ids of the blocks it bounds.
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

_BLOCK_ID_NAMESPACE = uuid.UUID("d5c3f39c-e22d-4887-a826-a0c1b337a9b0")


@dataclass(frozen=True)
class BlockKeyInput:
    """A derived face's bounding segments, and a point inside it (longitude, latitude)
    that only breaks ties between faces bounded by the same segments."""

    segment_ids: frozenset[uuid.UUID]
    representative_point: tuple[float, float]


def block_id_for(import_area_id: uuid.UUID, segment_ids: frozenset[uuid.UUID], ordinal: int = 0) -> uuid.UUID:
    key = ",".join(sorted(str(segment_id) for segment_id in segment_ids))
    suffix = f"#{ordinal}" if ordinal else ""
    return uuid.uuid5(_BLOCK_ID_NAMESPACE, f"{import_area_id}:{key}{suffix}")


def block_ids_for(import_area_id: uuid.UUID, faces: Sequence[BlockKeyInput]) -> list[uuid.UUID]:
    """One id per face, in input order.

    Faces bounded by the same segments, such as the two sides of one road
    crossing the whole bounding box, are told apart by their position,
    ordered by representative point, so input order never changes an id.
    """
    by_segments: dict[frozenset[uuid.UUID], list[int]] = defaultdict(list)
    for index, face in enumerate(faces):
        by_segments[face.segment_ids].append(index)
    ids: list[uuid.UUID | None] = [None] * len(faces)
    for segment_ids, indexes in by_segments.items():
        ranked = sorted(indexes, key=lambda index: faces[index].representative_point)
        for ordinal, index in enumerate(ranked):
            ids[index] = block_id_for(import_area_id, segment_ids, ordinal)
    return ids
