import uuid
from dataclasses import dataclass

from app.domain.bounding_box import Coordinate
from app.domain.enums import PoiCategory


@dataclass(frozen=True)
class PointOfInterest:
    id: uuid.UUID | None
    import_area_id: uuid.UUID
    source_id: str
    category: PoiCategory
    point: Coordinate
    name: str | None = None
