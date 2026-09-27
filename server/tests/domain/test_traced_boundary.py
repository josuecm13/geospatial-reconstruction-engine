import pytest

from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.traced_boundary import InvalidTracedBoundary, validate_traced_boundary

BBOX = BoundingBox(min_corner=Coordinate(30.0, -97.8), max_corner=Coordinate(30.004, -97.796))


def ring(*lat_lon: tuple[float, float]):
    return tuple(Coordinate(lat, lon) for lat, lon in lat_lon)


TRIANGLE = ring((30.001, -97.799), (30.001, -97.797), (30.003, -97.798), (30.001, -97.799))
WHOLE_BBOX = ring((30.0, -97.8), (30.0, -97.796), (30.004, -97.796), (30.004, -97.8), (30.0, -97.8))
# Concave "L": valid, and not convex, so containment can't be a shortcut on the hull.
L_SHAPE = ring(
    (30.001, -97.799),
    (30.001, -97.797),
    (30.002, -97.797),
    (30.002, -97.798),
    (30.003, -97.798),
    (30.003, -97.799),
    (30.001, -97.799),
)


@pytest.mark.parametrize("polygon", [TRIANGLE, WHOLE_BBOX, L_SHAPE], ids=["triangle", "whole-bbox", "concave"])
def test_accepts_valid_boundaries(polygon):
    assert validate_traced_boundary("Old town", polygon, BBOX) == "Old town"


def test_strips_the_name():
    assert validate_traced_boundary("  Old town ", TRIANGLE, BBOX) == "Old town"


@pytest.mark.parametrize(
    ("name", "polygon", "rule"),
    [
        ("   ", TRIANGLE, "blank_name"),
        ("x", ring((30.001, -97.799), (30.001, -97.797), (30.001, -97.799)), "too_few_vertices"),
        ("x", TRIANGLE[:-1] + ring((30.0015, -97.799)), "not_closed"),
        # Collinear: three distinct vertices, zero area.
        ("x", ring((30.001, -97.799), (30.002, -97.798), (30.003, -97.797), (30.001, -97.799)), "degenerate"),
        # Repeated consecutive vertex.
        (
            "x",
            ring((30.001, -97.799), (30.001, -97.797), (30.001, -97.797), (30.003, -97.798), (30.001, -97.799)),
            "degenerate",
        ),
        # Bow tie: edges 0 and 2 cross.
        (
            "x",
            ring((30.001, -97.799), (30.003, -97.797), (30.003, -97.799), (30.001, -97.797), (30.001, -97.799)),
            "self_intersecting",
        ),
        # Two lobes touching at one vertex (a pinch): invalid in PostGIS too.
        (
            "x",
            ring(
                (30.002, -97.798),
                (30.001, -97.799),
                (30.001, -97.7985),
                (30.002, -97.798),
                (30.003, -97.797),
                (30.003, -97.7975),
                (30.002, -97.798),
            ),
            "self_intersecting",
        ),
        # Spike: an edge doubles back along the previous one.
        (
            "x",
            ring((30.001, -97.799), (30.001, -97.797), (30.001, -97.798), (30.003, -97.798), (30.001, -97.799)),
            "self_intersecting",
        ),
        # A vertex touches a non-adjacent edge.
        (
            "x",
            ring(
                (30.001, -97.799),
                (30.001, -97.797),
                (30.003, -97.797),
                (30.001, -97.798),
                (30.003, -97.799),
                (30.001, -97.799),
            ),
            "self_intersecting",
        ),
        ("x", ring((30.001, -97.799), (30.001, -97.797), (30.005, -97.798), (30.001, -97.799)), "outside_import_area"),
    ],
    ids=[
        "blank-name",
        "too-few-vertices",
        "not-closed",
        "collinear",
        "repeated-vertex",
        "bow-tie",
        "pinch",
        "spike",
        "vertex-on-edge",
        "outside-bbox",
    ],
)
def test_rejects_invalid_boundaries_naming_the_rule(name, polygon, rule):
    with pytest.raises(InvalidTracedBoundary) as excinfo:
        validate_traced_boundary(name, polygon, BBOX)

    assert excinfo.value.rule == rule
