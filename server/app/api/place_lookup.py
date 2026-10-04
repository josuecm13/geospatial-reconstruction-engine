"""Names an import area after the place it covers, once its import has succeeded."""

from __future__ import annotations

from typing import Protocol

from app.domain.bounding_box import BoundingBox
from app.domain.import_area import ImportArea
from app.persistence.repositories.import_area import ImportAreaRepository


class Geocoder(Protocol):
    def reverse(self, latitude: float, longitude: float) -> tuple[str | None, str | None]: ...


def bbox_center(bbox: BoundingBox) -> tuple[float, float]:
    return (
        (bbox.min_corner.latitude + bbox.max_corner.latitude) / 2,
        (bbox.min_corner.longitude + bbox.max_corner.longitude) / 2,
    )


def name_area(areas: ImportAreaRepository, area: ImportArea, geocoder: Geocoder | None) -> ImportArea:
    """Looks the area's centre up and stores the answer. With no geocoder, or no answer, the area
    is returned as it was (an earlier name is kept)."""
    if geocoder is None:
        return area
    name, context = geocoder.reverse(*bbox_center(area.bbox))
    return areas.set_place(area.id, name, context)
