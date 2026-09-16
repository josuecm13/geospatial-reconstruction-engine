import math
from dataclasses import dataclass

EARTH_RADIUS_METERS = 6_371_000.0
MAX_AREA_SQUARE_METERS = 1_000_000.0  # 1 km x 1 km


class InvalidBoundingBox(ValueError):
    pass


@dataclass(frozen=True)
class Coordinate:
    latitude: float
    longitude: float

    def __post_init__(self) -> None:
        if not -90.0 <= self.latitude <= 90.0:
            raise InvalidBoundingBox(
                f"latitude {self.latitude} is out of range [-90, 90]"
            )
        if not -180.0 <= self.longitude <= 180.0:
            raise InvalidBoundingBox(
                f"longitude {self.longitude} is out of range [-180, 180]"
            )


def _haversine_meters(a: Coordinate, b: Coordinate) -> float:
    lat1, lon1, lat2, lon2 = map(
        math.radians, (a.latitude, a.longitude, b.latitude, b.longitude)
    )
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(h))


@dataclass(frozen=True)
class BoundingBox:
    min_corner: Coordinate
    max_corner: Coordinate

    def __post_init__(self) -> None:
        if self.min_corner.latitude >= self.max_corner.latitude:
            raise InvalidBoundingBox(
                "min latitude must be strictly less than max latitude"
            )
        if self.min_corner.longitude >= self.max_corner.longitude:
            raise InvalidBoundingBox(
                "min longitude must be strictly less than max longitude"
            )

        area = self.area_square_meters()
        if area > MAX_AREA_SQUARE_METERS:
            raise InvalidBoundingBox(
                f"bounding box area {area:.1f} m^2 exceeds the maximum of "
                f"{MAX_AREA_SQUARE_METERS:.1f} m^2 (1 km x 1 km)"
            )

    def width_meters(self) -> float:
        sw = self.min_corner
        se = Coordinate(self.min_corner.latitude, self.max_corner.longitude)
        return _haversine_meters(sw, se)

    def height_meters(self) -> float:
        sw = self.min_corner
        nw = Coordinate(self.max_corner.latitude, self.min_corner.longitude)
        return _haversine_meters(sw, nw)

    def area_square_meters(self) -> float:
        return self.width_meters() * self.height_meters()
