import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Elevation, Feature, MapData, Position } from "../api/types";
import { buildWorld, groundPlane, LAYER_ORDER, LAYER_Y, setRoadMode } from "./buildWorld";
import { MATERIALS } from "./palette";

const D = 0.0001; // about 11 m
const square = (lon: number, lat: number): Position[][] => [[[lon, lat], [lon + D, lat], [lon + D, lat + D], [lon, lat + D], [lon, lat]]];
const fc = <P>(features: Feature<P>[]) => ({ type: "FeatureCollection" as const, features });
const road = (id: string, coordinates: [number, number][], streetId = "street-1", laneType = "normal") =>
  ({
    type: "Feature",
    id,
    geometry: { type: "LineString", coordinates },
    properties: { street: { id: streetId, name: null, classification: "residential" }, width_meters: 6, lane_type: laneType },
  }) as never;

const data: MapData = {
  attribution: "© OpenStreetMap contributors",
  scope: { type: "import_area", id: "area-1", composed_area_ids: [] },
  mode: "filter",
  projection: { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 },
  road_segments: fc([road("r1", [[-84, 10], [-83.999, 10]]), road("r2", [[-83.999, 10], [-84, 10]]), road("r3", [[-84, 10.001], [-83.999, 10.001]], "street-2", "wide")]), // r2 is r1's reverse twin
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
    { type: "Feature", id: "bu1", geometry: { type: "Polygon", coordinates: square(-84, 10.0002) }, properties: { category: "house", block_id: null, height_meters: null, levels: null, import_area_id: "area-1", base_elevation_meters: null } },
    { type: "Feature", id: "bu2", geometry: { type: "Polygon", coordinates: square(-84, 10.0004) }, properties: { category: "house", block_id: null, height_meters: 12, levels: null, import_area_id: "area-1", base_elevation_meters: null } },
  ]),
  pois: fc([]),
  area_features: fc([{ type: "Feature", id: "a1", geometry: { type: "Polygon", coordinates: square(-84, 9.9998) }, properties: { kind: "water", import_area_id: "area-1" } },
    { type: "Feature", id: "a2", geometry: { type: "Polygon", coordinates: square(-84, 9.9996) }, properties: { kind: "park", import_area_id: "area-1" } },
  ]),
  elevation: null,
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
    expect(names("area_features")).toEqual(["area_feature:a1", "area_feature:a2"]);
    expect(names("blocks")).toEqual(["block:b1"]);
    expect(world.getObjectByName("building:bu2")!.userData).toMatchObject({ layer: "building", id: "bu2", properties: { height_meters: 12 } });
  });

  it("draws a two-way road once", () => {
    expect(names("roads")).toEqual(["road:r1", "road:r3"]);
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

  it("draws the flat layers in a fixed order that doesn't depend on the depth buffer", () => {
    const order = (name: string) => world.getObjectByName(name)!.renderOrder;
    const ground = world.getObjectByName("ground:plane")!.renderOrder;
    expect(ground).toBe(LAYER_ORDER.ground);
    expect(order("area_feature:a2")).toBe(LAYER_ORDER.green);
    expect(order("area_feature:a1")).toBe(LAYER_ORDER.water);
    expect(order("road:r1")).toBe(LAYER_ORDER.roadNormal);
    expect(order("road:r3")).toBe(LAYER_ORDER.roadWide);
    expect(order("block:b1")).toBe(LAYER_ORDER.blocks);
    expect(order("building:bu1")).toBe(0);
    const sequence = [ground, order("area_feature:a2"), order("area_feature:a1"), order("road:r1"), order("road:r3"), order("block:b1")];
    expect([...sequence].sort((a, b) => a - b)).toEqual(sequence);
    expect(new Set(sequence).size).toBe(sequence.length);
    expect(Math.max(...sequence)).toBeLessThan(0);
  });

  it("gives the flat materials no depth write, and the building materials one", () => {
    for (const key of ["ground", "green", "water", "roadNormal", "roadWide", "roadNarrow", "buildable"] as const) {
      expect(MATERIALS[key].depthWrite, key).toBe(false);
    }
    expect(MATERIALS.buildingMeasured.depthWrite).toBe(true);
    expect(MATERIALS.buildingDefaulted.depthWrite).toBe(true);
    expect(MATERIALS.buildable.transparent).toBe(true);
    expect(MATERIALS.buildable.opacity).toBe(0.25);
  });

  it("draws every face unlit, with its shade baked into the vertex colors and no mesh rotation", () => {
    const meshes: THREE.Mesh[] = [];
    world.traverse((object) => (object as THREE.Mesh).isMesh && meshes.push(object as THREE.Mesh));
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(material.isMeshBasicMaterial, mesh.name).toBe(true);
      expect(material.vertexColors, mesh.name).toBe(true);
      expect(mesh.geometry.getAttribute("color").count, mesh.name).toBe(mesh.geometry.getAttribute("position").count);
      expect(mesh.rotation.toArray().slice(0, 3), mesh.name).toEqual([0, 0, 0]);
    }
  });

  it("gives each building exactly one edges child, with the shared edge material, which isn't a mesh", () => {
    for (const id of ["bu1", "bu2"]) {
      const building = world.getObjectByName(`building:${id}`)!;
      const edges = building.children.filter((child) => child.name === "edges") as THREE.LineSegments[];
      expect(edges, id).toHaveLength(1);
      expect(building.children, id).toHaveLength(1);
      expect(edges[0].isLineSegments).toBe(true);
      expect((edges[0] as unknown as THREE.Mesh).isMesh).toBeFalsy();
      expect(edges[0].material).toBe(MATERIALS.edge);
      expect(edges[0].geometry.getAttribute("position").count).toBeGreaterThan(0);
    }
    expect(world.getObjectByName("roads")!.getObjectByName("edges")).toBeUndefined();
  });

  it("leaves the edge lines out of picking", () => {
    const edges = world.getObjectByName("building:bu1")!.getObjectByName("edges")!;
    const hits: THREE.Intersection[] = [];
    edges.raycast({} as THREE.Raycaster, hits);
    expect(hits).toEqual([]);
  });

  it("builds the ground plane in the first render slot", () => {
    const ground = groundPlane(-10, 10, -5, 5);
    expect(ground.name).toBe("ground:plane");
    expect(ground.renderOrder).toBe(LAYER_ORDER.ground);
    expect(ground.material).toBe(MATERIALS.ground);
  });

  it("stays flat without elevation: no terrain, buildings on y = 0, setRoadMode a no-op", () => {
    expect(world.userData.terrain.hasGround).toBe(false);
    expect(world.getObjectByName("building:bu1")!.position.y).toBe(0);
    expect(world.getObjectByName("road:r1")!.userData.drape).toBeUndefined();
    const before = [...(world.getObjectByName("road:r1") as THREE.Mesh).geometry.getAttribute("position").array];
    setRoadMode(world, "exact");
    expect([...(world.getObjectByName("road:r1") as THREE.Mesh).geometry.getAttribute("position").array]).toEqual(before);
  });
});

/** A 5 x 5 grid over the same ground, rising 10 m with each column to the east: 50 m at the west edge, 90 m at the east. */
const elevation: Elevation = {
  source: "aws-terrain-tiles",
  attribution: "terrain",
  version: 3,
  smoothing_meters: 30,
  grid: {
    origin: { latitude: 10, longitude: -84 },
    lat_step: 0.0005,
    lon_step: 0.0005,
    rows: 5,
    cols: 5,
    heights: Array.from({ length: 25 }, (_, i) => 50 + 10 * (i % 5)),
  },
};
const withHeights = (feature: never, exact: number[], smoothed: number[]) => {
  const f = feature as Feature<object>;
  return { ...f, properties: { ...f.properties, elevation_exact: exact, elevation_smoothed: smoothed } } as never;
};
const terrainData: MapData = {
  ...data,
  elevation,
  // Inside the grid (lat 10 to 10.002): a feature wholly outside it is not drawn on terrain.
  area_features: fc([
    { type: "Feature", id: "a1", geometry: { type: "Polygon", coordinates: square(-84, 10.0008) }, properties: { kind: "water", import_area_id: "area-1" } },
    { type: "Feature", id: "a2", geometry: { type: "Polygon", coordinates: square(-84, 10.0006) }, properties: { kind: "park", import_area_id: "area-1" } },
  ]),
  road_segments: fc([withHeights(road("r1", [[-84, 10], [-83.999, 10]]), [50, 50], [60, 60]), road("r3", [[-84, 10.001], [-83.999, 10.001]], "street-2", "wide")]),
  buildings: fc([
    // Base given by the server: 57 m above sea level is 7 m above the baseline (the grid's lowest point, 50 m).
    { type: "Feature", id: "bu1", geometry: { type: "Polygon", coordinates: square(-84, 10.0002) }, properties: { category: "house", block_id: null, height_meters: 9, levels: null, import_area_id: "area-1", base_elevation_meters: 57 } },
    // No base: the lowest ground under it. Its west edge is on the second grid column (60 m), so 10 m above the baseline.
    { type: "Feature", id: "bu2", geometry: { type: "Polygon", coordinates: square(-83.9995, 10.0002) }, properties: { category: "house", block_id: null, height_meters: 9, levels: null, import_area_id: "area-1", base_elevation_meters: null } },
  ]),
};

describe("buildWorld on terrain", () => {
  const world = buildWorld(terrainData);
  const ys = (name: string) => {
    const array = (world.getObjectByName(name) as THREE.Mesh).geometry.getAttribute("position").array;
    return Array.from({ length: array.length / 3 }, (_, i) => array[i * 3 + 1]);
  };

  it("keeps the terrain on the world, with the grid's lowest point as the baseline", () => {
    expect(world.userData.terrain.baseline).toBe(50);
    expect(world.userData.elevation).toMatchObject({ version: 3, attribution: "terrain" });
    expect(world.userData.roadMode).toBe("smoothed");
  });

  it("replaces the ground plane with a mesh that follows the slope", () => {
    const ground = world.getObjectByName("ground:plane") as THREE.Mesh;
    expect(ground.renderOrder).toBe(LAYER_ORDER.ground);
    expect(ground.material).toBe(MATERIALS.ground);
    const heights = ys("ground:plane");
    expect(Math.min(...heights)).toBeCloseTo(0, 3);
    expect(Math.max(...heights)).toBeGreaterThan(5);
  });

  it("stands each building on the server's base height, or the lowest ground under it", () => {
    expect(world.getObjectByName("building:bu1")!.position.y).toBeCloseTo(7);
    expect(world.getObjectByName("building:bu2")!.position.y).toBeCloseTo(10, 3);
    expect(world.getObjectByName("building:bu1")!.userData.height).toBe(9); // the extrusion is unchanged
  });

  it("drapes area features on the slope, keeping their layer offset on top", () => {
    const feature = world.getObjectByName("area_feature:a2") as THREE.Mesh;
    expect(feature.position.y).toBe(LAYER_Y.area_features);
    expect(Math.max(...ys("area_feature:a2"))).toBeGreaterThan(1); // it spans 11 m east, about 2 m of rise
    expect(world.getObjectByName("block:b1")!.position.y).toBe(LAYER_Y.blocks);
  });

  it("drapes a road on its smoothed heights, then the exact ones, without rebuilding", () => {
    const road = world.getObjectByName("road:r1") as THREE.Mesh;
    const geometry = road.geometry;
    const count = geometry.getAttribute("position").count;
    expect(road.position.y).toBe(LAYER_Y.roads);
    ys("road:r1").forEach((y) => expect(y).toBeCloseTo(10)); // smoothed: 60 m, 10 above the baseline

    setRoadMode(world, "exact");
    ys("road:r1").forEach((y) => expect(y).toBeCloseTo(0)); // exact: 50 m
    expect(world.userData.roadMode).toBe("exact");
    expect(road.geometry).toBe(geometry);
    expect(road.geometry.getAttribute("position").count).toBe(count);

    setRoadMode(world, "smoothed");
    ys("road:r1").forEach((y) => expect(y).toBeCloseTo(10));
  });

  it("samples the terrain under a road that has no stored heights", () => {
    const road = world.getObjectByName("road:r3") as THREE.Mesh;
    expect(road.userData.drape.heights).toEqual({ exact: null, smoothed: null });
    // r3 runs west to east across the slope from 0 to about 20 above the baseline (0.001 degrees is about 2 grid columns).
    const heights = ys("road:r3");
    expect(Math.min(...heights)).toBeCloseTo(0, 1);
    expect(Math.max(...heights)).toBeGreaterThan(15);
  });

  it("starts in the exact mode when asked", () => {
    const exact = buildWorld(terrainData, "exact");
    const array = (exact.getObjectByName("road:r1") as THREE.Mesh).geometry.getAttribute("position").array;
    for (let i = 1; i < array.length; i += 3) expect(array[i]).toBeCloseTo(0);
  });
});

describe("buildWorld on terrain with features far larger than the grid", () => {
  const km = 0.05; // degrees: about 5.5 km, against a grid about 220 m across
  const huge: Position[][] = [[[-84 - km, 10 - km], [-84 + km, 10 - km], [-84 + km, 10 + km], [-84 - km, 10 + km], [-84 - km, 10 - km]]];
  const world = buildWorld({
    ...terrainData,
    area_features: fc([{ type: "Feature", id: "river", geometry: { type: "Polygon", coordinates: huge }, properties: { kind: "water", import_area_id: "area-1" } }]),
  });
  const grid = world.userData.terrain.extent() as { minX: number; maxX: number; minZ: number; maxZ: number };
  const positions = (name: string) => (world.getObjectByName(name) as THREE.Mesh).geometry.getAttribute("position");

  it("keeps the water's vertex count bounded by the grid, not the polygon", () => {
    // Unclipped it would be thousands of triangles at one edge per 110 m; clipped it is the grid's few cells.
    expect(positions("area_feature:river").count).toBeLessThan(300);
  });

  it("puts no vertex of a draped layer outside the grid extent", () => {
    const eps = 1e-6;
    for (const name of ["area_feature:river", "road:r1", "road:r3"]) {
      const p = positions(name);
      for (let i = 0; i < p.count; i++) {
        expect(p.getX(i)).toBeGreaterThanOrEqual(grid.minX - eps);
        expect(p.getX(i)).toBeLessThanOrEqual(grid.maxX + eps);
        expect(p.getZ(i)).toBeGreaterThanOrEqual(grid.minZ - eps);
        expect(p.getZ(i)).toBeLessThanOrEqual(grid.maxZ + eps);
      }
    }
  });

  it("bounds the ground mesh by the grid, with the margin at most", () => {
    const p = positions("ground:plane");
    const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
    expect(box.min.x).toBeCloseTo(grid.minX - 20, 3);
    expect(box.max.x).toBeCloseTo(grid.maxX + 20, 3);
    expect(box.min.z).toBeCloseTo(grid.minZ - 20, 3);
    expect(box.max.z).toBeCloseTo(grid.maxZ + 20, 3);
  });

  it("draws nothing for a feature wholly outside the grid", () => {
    const outside = buildWorld({ ...terrainData, area_features: fc([{ type: "Feature", id: "far", geometry: { type: "Polygon", coordinates: square(-83, 11) }, properties: { kind: "water", import_area_id: "area-1" } }]) });
    expect(outside.getObjectByName("area_feature:far")).toBeUndefined();
  });
});
