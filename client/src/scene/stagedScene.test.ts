// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Feature, MapData, Position } from "../api/types";
import { bboxMeters, createStagedScene, INNER_AREA_LAYERS } from "./stagedScene";

const D = 0.0001;
const square = (lon: number, lat: number): Position[][] => [[[lon, lat], [lon + D, lat], [lon + D, lat + D], [lon, lat + D], [lon, lat]]];
const fc = <P>(features: Feature<P>[]) => ({ type: "FeatureCollection" as const, features });
const projection = { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 };

const inner: MapData = {
  attribution: "",
  scope: { type: "import_area", id: "inner-1", composed_area_ids: [] },
  mode: "filter",
  projection,
  road_segments: fc([
    {
      type: "Feature",
      id: "r1",
      geometry: { type: "LineString", coordinates: [[-84, 10], [-83.999, 10]] },
      properties: { street: { id: "s1", name: null, classification: "residential" }, width_meters: 6, lane_type: "normal" },
    },
  ]) as never,
  navigable_nodes: fc([]),
  blocks: fc([
    {
      type: "Feature",
      id: "b1",
      geometry: { type: "Polygon", coordinates: square(-84, 10) },
      properties: { area_square_meters: 100, buildable_area: { type: "Polygon", coordinates: square(-84, 10) }, buildable_area_square_meters: 90, is_median: false, is_clipped: false, import_area_id: "inner-1" },
    },
  ]),
  buildings: fc([
    { type: "Feature", id: "bu1", geometry: { type: "Polygon", coordinates: square(-84, 10.0002) }, properties: { category: "house", block_id: null, height_meters: null, levels: null, import_area_id: "inner-1" } },
  ]),
  pois: fc([]),
  area_features: fc([]),
};

describe("an inner area in a staged build", () => {
  it("adds its features, blocks and buildings but not its roads", () => {
    expect([...INNER_AREA_LAYERS]).toEqual(["area_features", "blocks", "buildings"]);
    const { handle, world } = createStagedScene(new THREE.Scene(), document.createElement("div")).begin({ min_latitude: 10, min_longitude: -84, max_latitude: 10.01, max_longitude: -83.99 });
    handle.apply({ layer: "fetched", projection, innerAreaIds: ["inner-1"] });
    handle.addBuilt(inner);
    expect(world.getObjectByName("roads")!.children).toHaveLength(0);
    expect(world.getObjectByName("buildings")!.children.map((c) => c.name)).toEqual(["building:bu1"]);
    expect(world.getObjectByName("blocks")!.children.map((c) => c.name)).toEqual(["block:b1"]);
  });
});

describe("bboxMeters", () => {
  it("measures a rectangle on the equator: 0.001 degree is pi * 6371000 / 180 / 1000 = 111.19 m each way", () => {
    const { width, height } = bboxMeters({ min_latitude: -0.0005, min_longitude: 0, max_latitude: 0.0005, max_longitude: 0.001 });
    expect(width).toBeCloseTo(111.19, 1);
    expect(height).toBeCloseTo(111.19, 1);
  });

  it("narrows the width with latitude: at 60 degrees a degree of longitude is half as long", () => {
    const { width, height } = bboxMeters({ min_latitude: 59.9995, min_longitude: 10, max_latitude: 60.0005, max_longitude: 10.001 });
    expect(width).toBeCloseTo(55.6, 1); // 111.19 * cos(60 degrees)
    expect(height).toBeCloseTo(111.19, 1);
  });
});
