import uuid
from dataclasses import dataclass

from app.domain.enums import BuildingCategory
from app.domain.geometry import Polygon


@dataclass(frozen=True)
class Building:
    id: uuid.UUID | None
    import_area_id: uuid.UUID
    source_id: str
    category: BuildingCategory
    geom: Polygon
    block_id: uuid.UUID | None = None
