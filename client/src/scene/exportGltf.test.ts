// @vitest-environment jsdom
import { validateBytes } from "gltf-validator";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Feature, MapData, Position } from "../api/types";
import { buildWorld, setRoadMode } from "./buildWorld";
import { exportWorld, glbFileName } from "./exportGltf";

const D = 0.0001;
const square = (lon: number, lat: number): Position[][] => [[[lon, lat], [lon + D, lat], [lon + D, lat + D], [lon, lat + D], [lon, lat]]];
const fc = <P>(features: Feature<P>[]) => ({ type: "FeatureCollection" as const, features });

const data: MapData = {
  attribution: "© OpenStreetMap contributors",
  scope: { type: "import_area", id: "area-1", composed_area_ids: [] },
  mode: "filter",
  projection: { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 },
  road_segments: fc([
    {
      type: "Feature",
      id: "r1",
      geometry: { type: "LineString", coordinates: [[-84, 10], [-83.999, 10]] },
      properties: { street: { id: "street-1", name: null, classification: "residential" }, width_meters: 6, lane_type: "normal" },
    } as never,
  ]),
  navigable_nodes: fc([]),
  blocks: fc([
    {
      type: "Feature",
      id: "b1",
      geometry: { type: "Polygon", coordinates: square(-84, 10) },
      properties: { area_square_meters: 100, buildable_area: { type: "Polygon", coordinates: square(-84, 10) }, buildable_area_square_meters: 90, is_median: false, is_clipped: false, import_area_id: "area-1", eligibility: "eligible", real_building_count: 0, generated_building_count: 0, is_reference: false, reference_block_id: null, style: null, feedback: null },
    },
  ]),
  buildings: fc([
    { type: "Feature", id: "bu1", geometry: { type: "Polygon", coordinates: square(-84, 10.0002) }, properties: { category: "house", block_id: null, height_meters: 12, levels: null, import_area_id: "area-1", base_elevation_meters: null } },
  ]),
  pois: fc([]),
  generation: null,
  generated_buildings: fc([]),
  generation_zones: fc([]),
  area_features: fc([]),
  elevation: null,
};

/** The glTF JSON chunk of a .glb: a 12-byte header, then the chunk length (4), type (4), and data. */
function jsonChunk(buffer: ArrayBuffer) {
  const length = new DataView(buffer).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
}

describe("exportWorld", () => {
  it("writes a .glb the Khronos validator accepts with no errors", async () => {
    const buffer = await exportWorld(buildWorld(data));
    expect(new TextDecoder().decode(new Uint8Array(buffer, 0, 4))).toBe("glTF");
    const report = await validateBytes(new Uint8Array(buffer));
    expect(report.issues.messages.filter((m) => m.severity === 0)).toEqual([]);
    expect(report.issues.numErrors).toBe(0);
  });

  it("exports unlit materials and the baked shade as vertex colors, so the file looks like the viewer", async () => {
    const json = jsonChunk(await exportWorld(buildWorld(data)));
    expect(json.extensionsUsed).toContain("KHR_materials_unlit");
    expect(json.materials.length).toBeGreaterThan(0);
    for (const material of json.materials) expect(material.extensions).toHaveProperty("KHR_materials_unlit");
    expect(json.meshes.length).toBeGreaterThan(0);
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) expect(primitive.attributes).toHaveProperty("COLOR_0");
  });

  it("exports no texture coordinates, and the world's geometries keep theirs afterwards", async () => {
    const world = buildWorld(data);
    const meshes: THREE.Mesh[] = [];
    world.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    expect(meshes.some((m) => m.geometry.getAttribute("uv"))).toBe(true); // there is something to take off
    const json = jsonChunk(await exportWorld(world));
    expect(json.meshes.length).toBeGreaterThan(0);
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) expect(primitive.attributes).not.toHaveProperty("TEXCOORD_0");
    for (const mesh of meshes) if (mesh.geometry.getAttribute("position")) expect(mesh.geometry.getAttribute("uv")).toBeDefined();
  });

  it("exports no normals (every material is unlit), and the world's geometries keep theirs afterwards", async () => {
    const world = buildWorld(data);
    const meshes: THREE.Mesh[] = [];
    world.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    const before = meshes.map((m) => m.geometry.getAttribute("normal"));
    expect(before.some(Boolean)).toBe(true); // there is something to take off
    const json = jsonChunk(await exportWorld(world));
    expect(json.meshes.length).toBeGreaterThan(0);
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) expect(primitive.attributes).not.toHaveProperty("NORMAL");
    meshes.forEach((m, i) => expect(m.geometry.getAttribute("normal")).toBe(before[i]));
  });

  it("leaves the building edge lines out of the file, and shows them again afterwards", async () => {
    const world = buildWorld(data);
    const edges = world.getObjectByName("building:bu1")!.getObjectByName("edges")!;
    const json = jsonChunk(await exportWorld(world));
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) expect(primitive.mode ?? 4).not.toBe(1);
    expect(json.nodes.map((n: { name?: string }) => n.name)).not.toContain("edges");
    expect(edges.visible).toBe(true);
  });

  it("names nodes by layer and id, and leaves out the hidden buildable-area layer", async () => {
    const json = jsonChunk(await exportWorld(buildWorld(data)));
    const names = json.nodes.map((n: { name?: string }) => n.name);
    expect(names).toEqual(expect.arrayContaining(["world", "roads", "buildings", "building:bu1", "road:r1", "ground:plane"]));
    expect(names).not.toContain("block:b1");
  });

  it("puts the scope, projection origin, and attribution on the root node and the asset", async () => {
    const json = jsonChunk(await exportWorld(buildWorld(data)));
    const root = json.nodes.find((n: { name?: string }) => n.name === "world");
    expect(root.extras).toEqual({
      generator: "geospatial-reconstruction-engine",
      scope: data.scope,
      projection: { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 },
      attribution: "© OpenStreetMap contributors",
      axes: "x east, y up, z south; meters",
    });
    expect(json.asset.copyright).toBe("© OpenStreetMap contributors");
    const building = json.nodes.find((n: { name?: string }) => n.name === "building:bu1");
    expect(building.extras).toEqual({ layer: "building", id: "bu1" });
  });

  it("exports only the world, even when it sits in a scene with lights", async () => {
    const world = buildWorld(data);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(), world);
    const names = jsonChunk(await exportWorld(world)).nodes.map((n: { name?: string }) => n.name);
    expect(names.some((n: string) => n === "" || n === undefined || /light/i.test(n))).toBe(false);
  });

  it("restores the world's own userData afterwards", async () => {
    const world = buildWorld(data);
    await exportWorld(world);
    expect(world.userData.footprints).toHaveLength(1);
    expect(world.getObjectByName("building:bu1")!.userData.properties).toMatchObject({ height_meters: 12 });
  });
});

describe("exportWorld with terrain", () => {
  const terrainData: MapData = {
    ...data,
    elevation: {
      source: "aws-terrain-tiles",
      attribution: "Terrain: test source",
      version: 4,
      smoothing_meters: 30,
      grid: { origin: { latitude: 10, longitude: -84 }, lat_step: 0.0005, lon_step: 0.0005, rows: 2, cols: 2, heights: [10, 10, 20, 20] },
    },
  };

  it("puts the grid version and the road mode in the root extras, and the terrain's credit in the copyright", async () => {
    const world = buildWorld(terrainData);
    const json = jsonChunk(await exportWorld(world));
    const root = json.nodes.find((n: { name?: string }) => n.name === "world");
    expect(root.extras.elevation).toEqual({ source: "aws-terrain-tiles", version: 4, attribution: "Terrain: test source", road_mode: "smoothed" });
    expect(root.extras.attribution).toBe("© OpenStreetMap contributors");
    expect(json.asset.copyright).toBe("© OpenStreetMap contributors · Terrain: test source");

    setRoadMode(world, "exact");
    const exact = jsonChunk(await exportWorld(world));
    expect(exact.nodes.find((n: { name?: string }) => n.name === "world").extras.elevation.road_mode).toBe("exact");
  });

  it("exports the terrain mesh as the ground, and a file the validator accepts", async () => {
    const buffer = await exportWorld(buildWorld(terrainData));
    const json = jsonChunk(buffer);
    expect(json.nodes.map((n: { name?: string }) => n.name)).toContain("ground:plane");
    const report = await validateBytes(new Uint8Array(buffer));
    expect(report.issues.numErrors).toBe(0);
  });

  it("leaves the elevation out of a flat world's extras", async () => {
    const json = jsonChunk(await exportWorld(buildWorld(data)));
    expect(json.nodes.find((n: { name?: string }) => n.name === "world").extras).not.toHaveProperty("elevation");
  });
});

describe("glbFileName", () => {
  it("is gre-<scope type>-<first 8 of the id>.glb", () => {
    expect(glbFileName({ type: "import_area", id: "area-1-abcdefgh" })).toBe("gre-import_area-area-1-a.glb");
  });
});
