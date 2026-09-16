import uuid
from dataclasses import dataclass
from datetime import datetime

from app.domain.bounding_box import BoundingBox
from app.domain.enums import ImportStatus


@dataclass(frozen=True)
class ImportArea:
    id: uuid.UUID | None
    provider: str
    bbox: BoundingBox
    status: ImportStatus
    road_count: int | None = None
    node_count: int | None = None
    building_count: int | None = None
    poi_count: int | None = None
    area_feature_count: int | None = None
    imported_at: datetime | None = None
