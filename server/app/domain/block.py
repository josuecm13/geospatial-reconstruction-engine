import uuid
from dataclasses import dataclass, field

from app.domain.geometry import MultiPolygon, Polygon

# A block's buildable area narrower than this everywhere can't hold a building,
# so the block is flagged as a median (typically the strip between a divided road's carriageways).
MIN_BUILDABLE_WIDTH_METERS = 5.0


@dataclass(frozen=True)
class Block:
    """`boundary` follows road centerlines; `buildable_area` is what's left once each
    bounding road's half-width is removed, None when nothing is."""

    id: uuid.UUID | None
    import_area_id: uuid.UUID
    boundary: Polygon
    area_square_meters: float
    bounding_segment_ids: tuple[uuid.UUID, ...] = field(default_factory=tuple)
    buildable_area: MultiPolygon | None = None
    buildable_area_square_meters: float = 0.0
    is_median: bool = False
