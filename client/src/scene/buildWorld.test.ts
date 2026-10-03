import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Feature, MapData, Position } from "../api/types";
import { buildWorld } from "./buildWorld";
import { MATERIALS } from "./palette";

const D = 0.0001; // about 11 m
const square = (lon: number, lat: number): Position[][] => [[[lon, lat], [lon + D, lat], [lon + D, lat + D], [lon, lat + D], [lon, lat]]];
const fc = <P>(features: Feature<P>[]) => ({ type: "FeatureCollection" as const, features });
const road = (id: string, coordinates: [number, number][]) =>
  ({
    type: "Feature",
    id,
    geometry: { type: "LineString", coordinates },
    properties: { street: { id: "street-1", name: null, classification: "residential" }, width_meters: 6, lane_type: "normal" },
  }) as never;

const data: MapData = {
  attribution: "© OpenStreetMap contributors",
  scope: { type: "import_area", id: "area-1", composed_area_ids: [] },
  mode: "filter",
  projection: { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 },
  road_segments: fc([road("r1", [[-84, 10], [-83.999, 10]]), road("r2", [[-83.999, 10], [-84, 10]])]), // r2 is r1's reverse twin
  navigable_nodes: fc([]),
  blocks: fc([
    {
      type: "Feature",
      id: "b1",
      geometry: { type: "Polygon", coordinates: square(-84, 10) },
      properties: { area_square_meters: 100, buildable_area: { type: "Polygon", coordinates: square(-84, 10) }, buildable_area_square_meters: 90, is_median: false, is_clipped: false, import_area_id: "area-1" },
    },
  ]),
  buildings: fc([
    { type: "Feature", id: "bu1", geometry: { type: "Polygon", coordinates: square(-84, 10.0002) }, properties: { category: "house", block_id: null, height_meters: null, levels: null, import_area_id: "area-1" } },
    { type: "Feature", id: "bu2", geometry: { type: "Polygon", coordinates: square(-84, 10.0004) }, properties: { category: "house", block_id: null, height_meters: 12, levels: null, import_area_id: "area-1" } },
  ]),
  pois: fc([]),
  area_features: fc([{ type: "Feature", id: "a1", geometry: { type: "Polygon", coordinates: square(-84, 9.9998) }, properties: { kind: "water", import_area_id: "area-1" } }]),
};

describe("buildWorld", () => {
  const world = buildWorld(data);
  const names = (group: string) => world.getObjectByName(group)!.children.map((c) => c.name);

  it("has the contract's groups, in order", () => {
    expect(world.name).toBe("world");
    expect(world.children.map((c) => c.name)).toEqual(["ground", "area_features", "roads", "blocks", "buildings", "generated"]);
    expect(world.userData).toMatchObject({ scope: data.scope, projection: data.projection, attribution: data.attribution });
  });

  it("names entity meshes <layer>:<id> and records their properties", () => {
    expect(names("buildings")).toEqual(["building:bu1", "building:bu2"]);
    expect(names("area_features")).toEqual(["area_feature:a1"]);
    expect(names("blocks")).toEqual(["block:b1"]);
    expect(world.getObjectByName("building:bu2")!.userData).toMatchObject({ layer: "building", id: "bu2", properties: { height_meters: 12 } });
  });

  it("draws a two-way road once", () => {
    expect(names("roads")).toEqual(["road:r1"]);
  });

  it("marks a building with no height or levels as defaulted, with the paler shared material", () => {
    const defaulted = world.getObjectByName("building:bu1") as THREE.Mesh;
    const measured = world.getObjectByName("building:bu2") as THREE.Mesh;
    expect(defaulted.userData.defaulted).toBe(true);
    expect(defaulted.material).toBe(MATERIALS.buildingDefaulted);
    expect(defaulted.userData.height).toBe(7);
    expect(measured.userData.defaulted).toBe(false);
    expect(measured.material).toBe(MATERIALS.buildingMeasured);
  });

  it("hides the buildable-area overlay by default", () => {
    expect(world.getObjectByName("blocks")!.visible).toBe(false);
  });
});
