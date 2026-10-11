// @vitest-environment jsdom
import { validateBytes } from "gltf-validator";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Feature, MapData, Position } from "../api/types";
import { buildWorld, roadOutlineLines, setRoadMode } from "./buildWorld";
import { exportWorld, glbFileName } from "./exportGltf";
import type { ExportOptions } from "./exportGltf";
import { setActiveTheme } from "./palette";
import { DEFAULT_THEME, themeById } from "./themes";
import type { ThemeId } from "./themes/types";

const night: ExportOptions = { theme: "night-clay", timeOfDay: "midday" };
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
    const buffer = await exportWorld(buildWorld(data), night);
    expect(new TextDecoder().decode(new Uint8Array(buffer, 0, 4))).toBe("glTF");
    const report = await validateBytes(new Uint8Array(buffer));
    expect(report.issues.messages.filter((m) => m.severity === 0)).toEqual([]);
    expect(report.issues.numErrors).toBe(0);
  });

  it("exports unlit materials and the baked shade as vertex colors, so the file looks like the viewer", async () => {
    const json = jsonChunk(await exportWorld(buildWorld(data), night));
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
    const json = jsonChunk(await exportWorld(world, night));
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
    const json = jsonChunk(await exportWorld(world, night));
    expect(json.meshes.length).toBeGreaterThan(0);
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) expect(primitive.attributes).not.toHaveProperty("NORMAL");
    meshes.forEach((m, i) => expect(m.geometry.getAttribute("normal")).toBe(before[i]));
  });

  it("leaves the building edge lines out of the file, and shows them again afterwards", async () => {
    const world = buildWorld(data);
    const edges = world.getObjectByName("building:bu1")!.getObjectByName("edges")!;
    const json = jsonChunk(await exportWorld(world, night));
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) expect(primitive.mode ?? 4).not.toBe(1);
    expect(json.nodes.map((n: { name?: string }) => n.name)).not.toContain("edges");
    expect(edges.visible).toBe(true);
  });

  it("names nodes by layer and id, and leaves out the hidden buildable-area layer", async () => {
    const json = jsonChunk(await exportWorld(buildWorld(data), night));
    const names = json.nodes.map((n: { name?: string }) => n.name);
    expect(names).toEqual(expect.arrayContaining(["world", "roads", "buildings", "building:bu1", "road:r1", "ground:plane"]));
    expect(names).not.toContain("block:b1");
  });

  it("leaves the dashed block outlines out of the file even while the blocks are shown, and keeps them visible afterwards", async () => {
    const world = buildWorld(data);
    world.getObjectByName("blocks")!.visible = true;
    const outline = world.getObjectByName("block_outline:b1")!;
    expect(outline).toBeDefined();

    const json = jsonChunk(await exportWorld(world, night));

    const names = json.nodes.map((n: { name?: string }) => n.name);
    expect(names).toContain("block:b1"); // the fill is a mesh, shown with the blocks
    expect(names).not.toContain("block_outline:b1");
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) expect([1, 2, 3]).not.toContain(primitive.mode); // no line primitives
    expect(outline.visible).toBe(true);
  });

  describe("generated buildings", () => {
    const withGenerated: MapData = {
      ...data,
      generated_buildings: fc([
        {
          type: "Feature",
          id: "g1",
          geometry: { type: "Polygon", coordinates: square(-84, 10.0004) },
          properties: { block_id: "b1", style: "regular", levels: 2, height_meters: 6.4, base_elevation_meters: null, reference_block_id: null, count_source: "default", generated: true },
        },
      ]),
    };
    const names = async (world: THREE.Group) => jsonChunk(await exportWorld(world, night)).nodes.map((n: { name?: string }) => n.name);

    it("includes them while the generated layer is shown, as nodes of their own layer", async () => {
      const json = jsonChunk(await exportWorld(buildWorld(withGenerated), night));

      expect(json.nodes.map((n: { name?: string }) => n.name)).toContain("generated:g1");
      expect(json.nodes.find((n: { name?: string }) => n.name === "generated:g1").extras).toEqual({ layer: "generated", id: "g1" });
    });

    it("leaves them out while the layer is hidden, and puts nothing back out of place", async () => {
      const world = buildWorld(withGenerated);
      world.getObjectByName("generated")!.visible = false;

      const hidden = await names(world);

      expect(hidden).not.toContain("generated:g1");
      expect(hidden).toContain("building:bu1"); // the real buildings are untouched
      expect(world.getObjectByName("generated")!.visible).toBe(false);
      world.getObjectByName("generated")!.visible = true;
      expect(await names(world)).toContain("generated:g1");
    });
  });

  it("puts the scope, projection origin, and attribution on the root node and the asset", async () => {
    const json = jsonChunk(await exportWorld(buildWorld(data), night));
    const root = json.nodes.find((n: { name?: string }) => n.name === "world");
    expect(root.extras).toEqual({
      generator: "geospatial-reconstruction-engine",
      scope: data.scope,
      projection: { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 },
      attribution: "© OpenStreetMap contributors",
      axes: "x east, y up, z south; meters",
      theme: "night-clay",
      time_of_day: "midday",
    });
    expect(json.asset.copyright).toBe("© OpenStreetMap contributors");
    const building = json.nodes.find((n: { name?: string }) => n.name === "building:bu1");
    expect(building.extras).toEqual({ layer: "building", id: "bu1" });
  });

  it("exports only the world, even when it sits in a scene with lights", async () => {
    const world = buildWorld(data);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(), world);
    const names = jsonChunk(await exportWorld(world, night)).nodes.map((n: { name?: string }) => n.name);
    expect(names.some((n: string) => n === "" || n === undefined || /light/i.test(n))).toBe(false);
  });

  it("restores the world's own userData afterwards", async () => {
    const world = buildWorld(data);
    await exportWorld(world, night);
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
    const json = jsonChunk(await exportWorld(world, night));
    const root = json.nodes.find((n: { name?: string }) => n.name === "world");
    expect(root.extras.elevation).toEqual({ source: "aws-terrain-tiles", version: 4, attribution: "Terrain: test source", road_mode: "smoothed" });
    expect(root.extras.attribution).toBe("© OpenStreetMap contributors");
    expect(json.asset.copyright).toBe("© OpenStreetMap contributors · Terrain: test source");

    setRoadMode(world, "exact");
    const exact = jsonChunk(await exportWorld(world, night));
    expect(exact.nodes.find((n: { name?: string }) => n.name === "world").extras.elevation.road_mode).toBe("exact");
  });

  it("exports the terrain mesh as the ground, and a file the validator accepts", async () => {
    const buffer = await exportWorld(buildWorld(terrainData), night);
    const json = jsonChunk(buffer);
    expect(json.nodes.map((n: { name?: string }) => n.name)).toContain("ground:plane");
    const report = await validateBytes(new Uint8Array(buffer));
    expect(report.issues.numErrors).toBe(0);
  });

  it("leaves the elevation out of a flat world's extras", async () => {
    const json = jsonChunk(await exportWorld(buildWorld(data), night));
    expect(json.nodes.find((n: { name?: string }) => n.name === "world").extras).not.toHaveProperty("elevation");
  });
});

/** A valid 1x1 PNG: jsdom has no canvas, so the exporter's image step is stubbed to produce this. */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe("exportWorld by theme", () => {
  const withGenerated: MapData = {
    ...data,
    generated_buildings: fc([
      {
        type: "Feature",
        id: "g1",
        geometry: { type: "Polygon", coordinates: square(-84, 10.0004) },
        properties: { block_id: "b1", style: "regular", levels: 2, height_meters: 6.4, base_elevation_meters: null, reference_block_id: null, count_source: "default", generated: true },
      },
    ]),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attributesOf = (json: any) => json.meshes.flatMap((m: any) => m.primitives.map((p: any) => p.attributes));
  const errors = async (buffer: ArrayBuffer) => (await validateBytes(new Uint8Array(buffer))).issues.messages.filter((m) => m.severity === 0);

  /** The world built in this theme, exported with the stubs jsdom needs for the textures. */
  async function exportIn(id: ThemeId) {
    stubCanvas();
    setActiveTheme(themeById(id));
    const world = buildWorld(withGenerated);
    if (id === "blueprint") world.getObjectByName("roads")!.add(roadOutlineLines(world));
    const buffer = await exportWorld(world, { theme: id, timeOfDay: "golden-hour" });
    return { world, buffer, json: jsonChunk(buffer) };
  }

  /** jsdom has no canvas: the exporter's 2D context and `toBlob` are stubbed so a DataTexture still becomes an image. */
  function stubCanvas() {
    vi.stubGlobal("ImageData", class {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ putImageData() {}, translate() {}, scale() {}, drawImage() {} } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob([PNG], { type: "image/png" }) as never));
  }

  afterEach(() => {
    setActiveTheme(DEFAULT_THEME);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["night-clay", "light-clay", "realistic", "blueprint"] as const)("exports a small %s world with no validator errors, and the theme and time in the extras", async (id) => {
    const { buffer, json } = await exportIn(id);
    expect(await errors(buffer)).toEqual([]);
    const root = json.nodes.find((n: { name?: string }) => n.name === "world");
    expect(root.extras).toMatchObject({ theme: id, time_of_day: "golden-hour" });
  });

  it("Night clay: unlit, vertex colours, no normals, no UVs, no lines", async () => {
    const { json } = await exportIn("night-clay");
    expect(json.extensionsUsed).toContain("KHR_materials_unlit");
    for (const material of json.materials) expect(material.extensions).toHaveProperty("KHR_materials_unlit");
    for (const attributes of attributesOf(json)) {
      expect(attributes).toHaveProperty("COLOR_0");
      expect(attributes).not.toHaveProperty("NORMAL");
      expect(attributes).not.toHaveProperty("TEXCOORD_0");
    }
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) expect(primitive.mode ?? 4).toBe(4);
  });

  it("Light clay: lit, with normals and no COLOR_0, and no lines", async () => {
    const { json } = await exportIn("light-clay");
    expect(json.extensionsUsed ?? []).not.toContain("KHR_materials_unlit");
    for (const attributes of attributesOf(json)) {
      expect(attributes).toHaveProperty("NORMAL");
      expect(attributes).not.toHaveProperty("COLOR_0");
      expect(attributes).not.toHaveProperty("TEXCOORD_0");
    }
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) expect(primitive.mode ?? 4).toBe(4);
  });

  it("Realistic: the buildings and the road carry UVs and a texture, with normals and no COLOR_0", async () => {
    const { json } = await exportIn("realistic");
    const names: string[] = json.nodes.map((n: { name?: string }) => n.name);
    expect(json.textures.length).toBeGreaterThan(0);
    expect(json.images.length).toBeGreaterThan(0);
    for (const name of ["building:bu1", "generated:g1", "road:r1"]) {
      const primitive = json.meshes[json.nodes[names.indexOf(name)].mesh].primitives[0];
      expect(primitive.attributes).toHaveProperty("TEXCOORD_0");
      expect(json.materials[primitive.material].pbrMetallicRoughness).toHaveProperty("baseColorTexture");
    }
    for (const attributes of attributesOf(json)) {
      expect(attributes).toHaveProperty("NORMAL");
      expect(attributes).not.toHaveProperty("COLOR_0");
    }
  });

  it("Blueprint: the building edges (generated ones too) and the road outlines are line primitives, the block outlines are not, and the fills keep their opacity", async () => {
    setActiveTheme(themeById("blueprint"));
    const world = buildWorld(withGenerated);
    world.getObjectByName("roads")!.add(roadOutlineLines(world));
    world.getObjectByName("blocks")!.visible = true;
    const json = jsonChunk(await exportWorld(world, { theme: "blueprint", timeOfDay: "midday" }));
    const names: string[] = json.nodes.map((n: { name?: string }) => n.name);
    const isLine = (n: { mesh?: number }) => n.mesh !== undefined && json.meshes[n.mesh].primitives.some((p: { mode?: number }) => p.mode === 1);
    const lineNodes = json.nodes.filter(isLine);
    expect(lineNodes.map((n: { name: string }) => n.name).sort()).toEqual(["edges", "edges", "road_outlines"]);
    expect(names).not.toContain("block_outline:b1");
    for (const node of lineNodes) for (const primitive of json.meshes[node.mesh].primitives) expect(json.materials[primitive.material].extensions).toHaveProperty("KHR_materials_unlit");
    const building = json.nodes[names.indexOf("building:bu1")];
    const material = json.materials[json.meshes[building.mesh].primitives[0].material];
    expect(material.alphaMode).toBe("BLEND");
    expect(material.pbrMetallicRoughness.baseColorFactor[3]).toBeCloseTo(0.16);
  });

  it.each(["night-clay", "light-clay", "realistic", "blueprint"] as const)("%s: puts the world's attributes, materials, userData and line visibility back", async (id) => {
    stubCanvas();
    setActiveTheme(themeById(id));
    const world = buildWorld(withGenerated);
    world.getObjectByName("roads")!.add(roadOutlineLines(world));
    const objects: THREE.Object3D[] = [];
    world.traverse((o) => objects.push(o));
    const snapshot = () =>
      objects.map((o) => {
        const target = o as THREE.Mesh;
        const attributes: Record<string, unknown> = target.geometry ? { ...target.geometry.attributes } : {};
        return { userData: o.userData, visible: o.visible, material: target.material, attributes };
      });
    const before = snapshot();
    await exportWorld(world, { theme: id, timeOfDay: "midday" });
    const after = snapshot();
    expect(after).toHaveLength(before.length);
    after.forEach((entry, i) => {
      expect(entry.userData).toBe(before[i].userData);
      expect(entry.visible).toBe(before[i].visible);
      expect(entry.material).toBe(before[i].material);
      expect(Object.keys(entry.attributes).sort()).toEqual(Object.keys(before[i].attributes).sort()); // re-adding changes the key order, which is harmless
      for (const [name, attribute] of Object.entries(entry.attributes)) expect(attribute).toBe(before[i].attributes[name]);
    });
  });
});

describe("glbFileName", () => {
  it("is gre-<scope type>-<first 8 of the id>.glb", () => {
    expect(glbFileName({ type: "import_area", id: "area-1-abcdefgh" })).toBe("gre-import_area-area-1-a.glb");
  });
});
