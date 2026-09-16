import enum


class ImportStatus(str, enum.Enum):
    PENDING = "pending"
    IMPORTING = "importing"
    COMPLETED = "completed"
    FAILED = "failed"


class RoadClassification(str, enum.Enum):
    MOTORWAY = "motorway"
    TRUNK = "trunk"
    PRIMARY = "primary"
    SECONDARY = "secondary"
    TERTIARY = "tertiary"
    RESIDENTIAL = "residential"
    SERVICE = "service"
    UNCLASSIFIED = "unclassified"


class BuildingCategory(str, enum.Enum):
    RESIDENTIAL = "residential"
    COMMERCIAL = "commercial"
    INDUSTRIAL = "industrial"
    CIVIC = "civic"
    UNSPECIFIED = "unspecified"


class PoiCategory(str, enum.Enum):
    FOOD_AND_DRINK = "food_and_drink"
    SHOPPING = "shopping"
    HEALTH = "health"
    EDUCATION = "education"
    TRANSIT = "transit"
    OTHER = "other"


class AreaFeatureKind(str, enum.Enum):
    PARK = "park"
    WATER = "water"
    GREEN_SPACE = "green_space"


class MovementKind(str, enum.Enum):
    LEFT = "left"
    RIGHT = "right"
    STRAIGHT = "straight"
    U_TURN = "u_turn"


class RestrictionKind(str, enum.Enum):
    NONE = "none"
    NO_LEFT_TURN = "no_left_turn"
    NO_RIGHT_TURN = "no_right_turn"
    NO_STRAIGHT_ON = "no_straight_on"
    NO_U_TURN = "no_u_turn"
    ONLY_LEFT_TURN = "only_left_turn"
    ONLY_RIGHT_TURN = "only_right_turn"
    ONLY_STRAIGHT_ON = "only_straight_on"
