import uuid
from dataclasses import dataclass

from app.domain.enums import AreaFeatureKind
from app.domain.geometry import Polygon


@dataclass(frozen=True)
class AreaFeature:
    id: uuid.UUID | None
    import_area_id: uuid.UUID
    source_id: str
    kind: AreaFeatureKind
    geom: Polygon
