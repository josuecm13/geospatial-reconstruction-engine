import uuid
from dataclasses import dataclass, field

from app.domain.geometry import Polygon


@dataclass(frozen=True)
class Block:
    id: uuid.UUID | None
    import_area_id: uuid.UUID
    boundary: Polygon
    area_square_meters: float
    bounding_segment_ids: tuple[uuid.UUID, ...] = field(default_factory=tuple)
