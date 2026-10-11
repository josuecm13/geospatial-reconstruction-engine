"""Generated content in map-data (Milestone 11, #23): the run, the generated buildings and zones, and
the generation properties of each block."""

import pytest

from tests.api.test_generation_api import area, block_id, generate, inline, insert_block  # noqa: F401

BLOCK_KEYS = {
    "eligibility",
    "real_building_count",
    "generated_building_count",
    "is_reference",
    "reference_block_id",
    "style",
    "feedback",
}
BUILDING_KEYS = {
    "block_id",
    "style",
    "levels",
    "height_meters",
    "base_elevation_meters",
    "reference_block_id",
    "count_source",
    "generated",
    "import_area_id",
}
WHOLE_AREA = [[-84.0809, 9.9331], [-84.0791, 9.9331], [-84.0791, 9.9349], [-84.0809, 9.9349], [-84.0809, 9.9331]]
SOUTH_WEST_CORNER = [[-84.0809, 9.9331], [-84.0807, 9.9331], [-84.0807, 9.9333], [-84.0809, 9.9333], [-84.0809, 9.9331]]


def _map_data(client, area_id, **params):
    response = client.get(f"/import-areas/{area_id}/map-data", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _block(map_data, block_id):
    return next(feature for feature in map_data["blocks"]["features"] if feature["id"] == block_id)


def _boundary(client, area_id, ring):
    response = client.post(
        f"/import-areas/{area_id}/boundaries", json={"name": "Scope", "geometry": {"type": "Polygon", "coordinates": [ring]}}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_without_a_run_the_generation_is_null_the_layers_are_empty_and_the_blocks_say_so(client, area, block_id):
    body = _map_data(client, area)

    assert body["generation"] is None
    assert body["generated_buildings"] == {"type": "FeatureCollection", "features": []}
    assert body["generation_zones"] == {"type": "FeatureCollection", "features": []}
    properties = _block(body, block_id)["properties"]
    assert BLOCK_KEYS <= set(properties)
    assert {key: properties[key] for key in BLOCK_KEYS} == {
        "eligibility": "eligible",
        "real_building_count": 0,
        "generated_building_count": 0,
        "is_reference": False,
        "reference_block_id": None,
        "style": None,
        "feedback": None,
    }


def test_with_a_run_the_layers_and_block_properties_are_filled(client, area, block_id):
    client.put(f"/blocks/{block_id}/feedback", json={"building_count": 500})
    generate(client, area, seed=9)

    body = _map_data(client, area)

    assert body["generation"]["seed"] == 9 and body["generation"]["stale"] is False
    assert body["generation"]["feedback_shortfall_block_ids"] == [block_id]
    buildings = body["generated_buildings"]["features"]
    assert buildings and len(buildings) == body["generation"]["building_count"]
    for feature in buildings:
        assert feature["geometry"]["type"] == "Polygon"
        assert BUILDING_KEYS == set(feature["properties"])
        assert feature["properties"]["generated"] is True
        assert feature["properties"]["block_id"] == block_id and feature["properties"]["import_area_id"] == area
        assert feature["properties"]["count_source"] == "feedback"
    zones = body["generation_zones"]["features"]
    assert zones and all(set(zone["properties"]) == {"block_id", "reason"} for zone in zones)
    assert {zone["properties"]["reason"] for zone in zones} <= {"water", "steep", "landuse", "setback"}
    assert "setback" in {zone["properties"]["reason"] for zone in zones}
    properties = _block(body, block_id)["properties"]
    assert properties["generated_building_count"] == len(buildings)
    assert properties["style"] in {"regular", "sparse", "informal"}
    assert properties["is_reference"] is False and properties["reference_block_id"] is None
    assert properties["feedback"]["building_count"] == 500 and properties["feedback"]["no_buildings"] is False
    assert properties["feedback"]["updated_at"]


def test_a_block_that_is_not_eligible_says_why_and_has_no_style(client, db_session, area, block_id):
    median = insert_block(db_session, area, x0=-100, y0=-60, x1=-20, y1=-10, is_median=True)
    generate(client, area)

    properties = _block(_map_data(client, area), median)["properties"]

    assert properties["eligibility"] == "median"
    assert (properties["generated_building_count"], properties["style"]) == (0, None)


def test_clip_mode_returns_the_new_layers_too(client, area, block_id):
    generate(client, area)
    filtered = _map_data(client, area)

    clipped = _map_data(client, area, mode="clip")

    assert len(clipped["generated_buildings"]["features"]) == len(filtered["generated_buildings"]["features"]) > 0
    assert len(clipped["generation_zones"]["features"]) == len(filtered["generation_zones"]["features"]) > 0
    assert clipped["generation"] == filtered["generation"]


@pytest.mark.parametrize("mode", ["filter", "clip"])
def test_a_boundary_scopes_the_generated_layers_like_buildings(client, area, block_id, mode):
    generate(client, area)
    whole = _boundary(client, area, WHOLE_AREA)
    corner = client.post(
        f"/import-areas/{area}/boundaries", json={"name": "Corner", "geometry": {"type": "Polygon", "coordinates": [SOUTH_WEST_CORNER]}}
    ).json()["id"]

    everything = _map_data(client, area, mode=mode, boundary_id=whole)
    nothing = _map_data(client, area, mode=mode, boundary_id=corner)

    assert len(everything["generated_buildings"]["features"]) > 0
    assert len(everything["generation_zones"]["features"]) > 0
    assert nothing["generated_buildings"]["features"] == [] and nothing["generation_zones"]["features"] == []
    assert _block(everything, block_id)["properties"]["generated_building_count"] > 0
    assert nothing["generation"] is not None  # the run belongs to the area, not to the scope


def test_a_stale_run_says_why_in_map_data(client, db_session, area, block_id):
    generate(client, area)
    insert_block(db_session, area, x0=-100, y0=-60, x1=-20, y1=-10)

    generation = _map_data(client, area)["generation"]

    assert generation["stale"] is True and generation["stale_reasons"] == ["roads_changed"]
