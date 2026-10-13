import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Elevation, Feature, GeneratedBuildingProperties, MapData, Position } from "../api/types";
import { buildWorld as buildBatched, generatedMeshes, groundPlane, LAYER_ORDER, LAYER_Y, OUTLINE_LIFT, redrawBlockOutlines, roadOutlineLines, setRoadMode } from "./buildWorld";
import type { RoadMode } from "./terrain";
import { FALLBACK_HEIGHT } from "./buildingHeight";
import { MATERIALS } from "./palette";

/** One mesh per building, named `<layer>:<id>`: the shape the glTF export writes, and what most of these tests read. The merged chunks have a describe of their own below. */
const buildWorld = (data: MapData, roadMode?: RoadMode) => buildBatched(data, roadMode, { batched: false });

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
      properties: { area_square_meters: 100, buildable_area: { type: "Polygon", coordinates: square(-84, 10) }, buildable_area_square_meters: 90, is_median: false, is_clipped: false, import_area_id: "area-1", eligibility: "eligible", real_building_count: 0, generated_building_count: 0, is_reference: false, reference_block_id: null, style: null, feedback: null },
    },
  ]),
  buildings: fc([
    { type: "Feature", id: "bu1", geometry: { type: "Polygon", coordinates: square(-84, 10.0002) }, properties: { category: "house", block_id: null, height_meters: null, levels: null, import_area_id: "area-1", base_elevation_meters: null } },
    { type: "Feature", id: "bu2", geometry: { type: "Polygon", coordinates: square(-84, 10.0004) }, properties: { category: "house", block_id: null, height_meters: 12, levels: null, import_area_id: "area-1", base_elevation_meters: null } },
  ]),
  pois: fc([]),
  generation: null,
  generated_buildings: fc([]),
  generation_zones: fc([]),
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

  it("draws each land-use kind in its own material, and an unknown kind as green", () => {
    const kinds = ["water", "forest", "farmland", "cemetery", "railway", "industrial", "park", "quarry"];
    const landuse = buildWorld({
      ...data,
      area_features: fc(kinds.map((kind, i) => ({ type: "Feature" as const, id: kind, geometry: { type: "Polygon" as const, coordinates: square(-84, 9.999 - i * 0.0003) }, properties: { kind, import_area_id: "area-1" } }))),
    });
    const material = (kind: string) => (landuse.getObjectByName(`area_feature:${kind}`) as THREE.Mesh).material;
    expect(material("forest")).toBe(MATERIALS.forest);
    expect(material("farmland")).toBe(MATERIALS.farmland);
    expect(material("cemetery")).toBe(MATERIALS.cemetery);
    expect(material("railway")).toBe(MATERIALS.railway);
    expect(material("industrial")).toBe(MATERIALS.industrial);
    expect(material("water")).toBe(MATERIALS.water);
    expect(material("park")).toBe(MATERIALS.green);
    expect(material("quarry")).toBe(MATERIALS.green);
  });

  it("names entity meshes <layer>:<id> and records their properties", () => {
    expect(names("buildings")).toEqual(["building:bu1", "building:bu2"]);
    expect(names("area_features")).toEqual(["area_feature:a1", "area_feature:a2"]);
    expect(names("blocks")).toEqual(["block_outline:b1", "block:b1"]);
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
    // Category "house" with no type is not low-rise housing, so it takes the fallback height.
    expect(defaulted.userData.height).toBe(FALLBACK_HEIGHT);
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

  it("gives the ground and the building materials a depth write, and the layers on the ground none", () => {
    expect(MATERIALS.ground.depthWrite).toBe(true);
    for (const key of ["green", "water", "roadNormal", "roadWide", "roadNarrow", "buildable"] as const) {
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

describe("buildWorld generated buildings", () => {
  const generated = (id: string, lon: number, lat: number, base: number | null, height = 6.4) =>
    ({
      type: "Feature",
      id,
      geometry: { type: "Polygon", coordinates: square(lon, lat) },
      properties: { block_id: "b1", style: "regular", levels: 2, height_meters: height, base_elevation_meters: base, reference_block_id: null, count_source: "default", generated: true },
    }) as Feature<GeneratedBuildingProperties>;

  it("fills the generated group, extruded to height_meters in the generated material, tagged as generated", () => {
    const world = buildWorld({ ...data, generated_buildings: fc([generated("g1", -84, 10.0004, null), generated("g2", -84, 10.0006, null, 9.6)]) });
    const group = world.getObjectByName("generated")!;

    expect(group.children.map((child) => child.name)).toEqual(["generated:g1", "generated:g2"]);
    const mesh = group.children[1] as THREE.Mesh;
    expect(mesh.material).toBe(MATERIALS.buildingGenerated);
    expect(mesh.userData).toMatchObject({ layer: "generated", id: "g2", generated: true, height: 9.6 });
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(9.6, 3);
    expect(world.getObjectByName("buildings")!.children.map((child) => child.name)).toEqual(["building:bu1", "building:bu2"]);
  });

  it("generatedMeshes builds the same meshes without a world: named, tagged, extruded and edged from the features", () => {
    const terrain = buildWorld(data).userData.terrain;
    const meshes = generatedMeshes([generated("g1", -84, 10.0004, null, 8), generated("g2", -84, 10.0006, null, 12)], terrain, data.projection, false);

    expect(meshes.map((mesh) => mesh.name)).toEqual(["generated:g1", "generated:g2"]);
    expect(meshes.every((mesh) => mesh.userData.generated === true && mesh.material === MATERIALS.buildingGenerated)).toBe(true);
    expect(meshes.map((mesh) => mesh.userData.height)).toEqual([8, 12]);
    expect(meshes.map((mesh) => mesh.getObjectByName("edges") !== undefined)).toEqual([true, true]);
    meshes[1].geometry.computeBoundingBox();
    expect(meshes[1].geometry.boundingBox!.max.y).toBeCloseTo(12, 3);
    expect(meshes.map((mesh) => mesh.position.y)).toEqual([0, 0]); // no terrain: on the ground
  });

  it("generatedMeshes stands a building on its stored base elevation minus the baseline, and skips a feature with no footprint", () => {
    const elevated = buildWorld({ ...data, elevation });
    const terrain = elevated.userData.terrain;
    const [mesh, ...rest] = generatedMeshes(
      [generated("g1", -84, 10.0004, 25), { ...generated("g2", -84, 10.0006, null), geometry: null } as never],
      terrain,
      data.projection,
      false,
    );
    expect(rest).toEqual([]);
    expect(mesh.position.y).toBeCloseTo(25 - terrain.baseline, 6);
  });

  it("gives each generated building edge lines in the generated-edge material, with line distances for the dashes", () => {
    const world = buildWorld({ ...data, generated_buildings: fc([generated("g1", -84, 10.0004, null)]) });
    const edges = world.getObjectByName("generated:g1")!.getObjectByName("edges") as THREE.LineSegments;

    expect(edges.material).toBe(MATERIALS.edgeGenerated);
    expect(edges.geometry.getAttribute("lineDistance")).toBeDefined();
    const measured = world.getObjectByName("building:bu1")!.getObjectByName("edges") as THREE.LineSegments;
    expect(measured.material).toBe(MATERIALS.edge);
    expect(measured.geometry.getAttribute("lineDistance")).toBeUndefined();
  });

  it("roadOutlineLines builds one pickless object from the road outlines, at road height on a flat world", () => {
    const world = buildWorld(data);
    const lines = roadOutlineLines(world);

    expect(lines.name).toBe("road_outlines");
    expect(lines.material).toBe(MATERIALS.roadOutline);
    const hits: THREE.Intersection[] = [];
    lines.raycast(new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0)), hits);
    expect(hits).toEqual([]);
    const position = lines.geometry.getAttribute("position");
    const outlines = world.userData.roadOutlines as unknown[][];
    expect(outlines.length).toBe(2); // r2, the twin of r1, is left out
    expect(position.count % 2).toBe(0); // segment pairs
    expect(position.count).toBeGreaterThanOrEqual(outlines.reduce((sum, outline) => sum + outline.length * 2, 0));
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBeGreaterThanOrEqual(LAYER_Y.roads);
      expect(position.getY(i)).toBeLessThan(LAYER_Y.roads + 0.5);
    }
  });

  it("leaves the group empty without a run", () => {
    expect(buildWorld(data).getObjectByName("generated")!.children).toEqual([]);
  });

  it("stands on its stored base height minus the baseline, or the lowest ground under it, on terrain", () => {
    const world = buildWorld({ ...terrainData, generated_buildings: fc([generated("g1", -84, 10.0004, 57), generated("g2", -83.9995, 10.0004, null)]) });

    expect(world.getObjectByName("generated:g1")!.position.y).toBeCloseTo(7); // 57 m, 7 above the 50 m baseline: as a real building
    expect(world.getObjectByName("generated:g2")!.position.y).toBeCloseTo(10, 3);
    expect(world.getObjectByName("generated:g1")!.userData.height).toBe(6.4); // the extrusion is unchanged
  });
});

describe("buildWorld block outlines and zones", () => {
  const block = (id: string, lat: number, extra: Partial<MapData["blocks"]["features"][number]["properties"]> = {}, buildable = true) =>
    ({
      type: "Feature",
      id,
      geometry: { type: "Polygon", coordinates: square(-84, lat) },
      properties: {
        area_square_meters: 100,
        buildable_area: buildable ? { type: "Polygon", coordinates: square(-84, lat) } : null,
        buildable_area_square_meters: buildable ? 90 : 0,
        is_median: false,
        is_clipped: false,
        import_area_id: "area-1",
        eligibility: "eligible",
        real_building_count: 0,
        generated_building_count: 0,
        is_reference: false,
        reference_block_id: null,
        style: null,
        feedback: null,
        ...extra,
      },
    }) as MapData["blocks"]["features"][number];
  const outline = (world: THREE.Object3D, id: string) => world.getObjectByName(`block_outline:${id}`) as THREE.Line;
  const xz = (line: THREE.Line) => {
    const position = line.geometry.getAttribute("position");
    return Array.from({ length: position.count }, (_, i) => ({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) }));
  };

  it("draws each block's outline 1.5 m inside its boundary, dashed, inside the hidden blocks group", () => {
    const world = buildWorld({ ...data, blocks: fc([block("b1", 10)]) });
    const line = outline(world, "b1");
    const points = xz(line);
    const [width, depth] = [Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.z)) - Math.min(...points.map((p) => p.z))];

    expect(line.isLine).toBe(true);
    expect(line.parent!.name).toBe("blocks");
    expect(line.material).toBe(MATERIALS.blockOutline);
    expect(line.userData).toMatchObject({ layer: "block_outline", id: "b1", kind: "crisp" });
    expect(line.geometry.getAttribute("lineDistance")).toBeDefined(); // computeLineDistances ran, so the dashes show
    expect(width).toBeCloseTo(D * 109_000 - 3, 3);
    expect(depth).toBeCloseTo(D * 110_000 - 3, 3);
    expect(points[0]).toEqual(points[points.length - 1]); // closed
  });

  it("draws a faint dotted outline for a block that isn't eligible, and a reference block apart", () => {
    const world = buildWorld({
      ...data,
      blocks: fc([block("a", 10), block("c", 10.0002, { eligibility: "clipped" }), block("m", 10.0004, { eligibility: "median" }), block("n", 10.0006, { eligibility: "no_buildable_area" }, false), block("r", 10.0008, { is_reference: true })]),
    });

    expect(outline(world, "a").material).toBe(MATERIALS.blockOutline);
    for (const id of ["c", "m", "n"]) expect(outline(world, id).material, id).toBe(MATERIALS.blockOutlineFaint);
    expect(outline(world, "r").material).toBe(MATERIALS.blockOutlineReference);
  });

  it("fills only an eligible block; the others keep their outline and stay in the selection index", () => {
    const world = buildWorld({
      ...data,
      blocks: fc([block("e", 10), block("c", 10.0002, { eligibility: "clipped" }), block("m", 10.0004, { eligibility: "median" }), block("o", 10.0006, { eligibility: undefined })]),
    });

    expect(world.getObjectByName("block:e")).toBeDefined();
    expect(world.getObjectByName("block:o")).toBeDefined(); // no eligibility: treated as eligible, as the outline is
    for (const id of ["c", "m"]) {
      expect(world.getObjectByName(`block:${id}`), id).toBeUndefined();
      expect(outline(world, id), id).toBeDefined();
    }
    expect(world.userData.blockIndex.map((b: { id: string }) => b.id)).toEqual(["e", "c", "m", "o"]);
  });

  it("outlines a block with no buildable area too, and keeps it findable for selection", () => {
    const world = buildWorld({ ...data, blocks: fc([block("n", 10, { eligibility: "no_buildable_area" }, false)]) });

    expect(outline(world, "n")).toBeDefined();
    expect(world.getObjectByName("block:n")).toBeUndefined(); // no fill without a buildable area
    expect(world.userData.blockIndex).toHaveLength(1);
    expect(world.userData.blockIndex[0]).toMatchObject({ id: "n", properties: { eligibility: "no_buildable_area" } });
  });

  it("drapes an outline on the terrain, a little above the ground at every vertex", () => {
    const world = buildWorld({ ...terrainData, blocks: fc([block("b1", 10.0008)]) });
    const terrain = world.userData.terrain;
    const points = xz(outline(world, "b1"));

    expect(points.length).toBeGreaterThanOrEqual(5);
    for (const p of points) expect(p.y).toBeCloseTo(terrain.heightAtLocal(p.x, p.z) + OUTLINE_LIFT, 4);
    expect(Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y))).toBeGreaterThan(1); // it climbs the slope
  });

  it("adds vertices along a long edge on terrain, at most one grid cell apart", () => {
    const long = { ...block("l", 10.0008), geometry: { type: "Polygon" as const, coordinates: [[[-84, 10.0008], [-83.9985, 10.0008], [-83.9985, 10.001], [-84, 10.001], [-84, 10.0008]]] as Position[][] } };
    const world = buildWorld({ ...terrainData, blocks: fc([long]) });
    const spacing = world.userData.terrain.spacing;
    const points = xz(outline(world, "l"));

    for (let i = 1; i < points.length; i++) expect(Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)).toBeLessThanOrEqual(spacing + 1e-6);
    expect(points.length).toBeGreaterThan(5);
  });

  it("draws the generation zones in the blocks group, each reason in its own material", () => {
    const zone = (id: string, reason: "water" | "steep" | "landuse" | "setback", lat: number) =>
      ({ type: "Feature", id, geometry: { type: "Polygon", coordinates: square(-84, lat) }, properties: { block_id: "b1", reason } }) as MapData["generation_zones"]["features"][number];
    const world = buildWorld({ ...data, generation_zones: fc([zone("z1", "water", 10), zone("z2", "steep", 10.0002), zone("z3", "landuse", 10.0004), zone("z4", "setback", 10.0006)]) });
    const mesh = (id: string) => world.getObjectByName(`zone:${id}`) as THREE.Mesh;

    expect(mesh("z1").parent!.name).toBe("blocks");
    expect(mesh("z1").material).toBe(MATERIALS.zoneWater);
    expect(mesh("z2").material).toBe(MATERIALS.zoneSteep);
    expect(mesh("z3").material).toBe(MATERIALS.zoneLanduse);
    expect(mesh("z4").material).toBe(MATERIALS.zoneSetback);
    expect(mesh("z1").renderOrder).toBe(LAYER_ORDER.zones);
    expect(mesh("z1").position.y).toBe(LAYER_Y.zones);
    expect(world.getObjectByName("blocks")!.visible).toBe(false); // shown with the outlines, by "Show blocks"
  });

  it("draws no zones without a run", () => {
    expect(buildWorld(data).getObjectByName("blocks")!.children.some((child) => child.name.startsWith("zone:"))).toBe(false);
  });
});

describe("buildWorld batched buildings", () => {
  const generated = (id: string, block: string, lat: number, base: number | null = null) =>
    ({
      type: "Feature",
      id,
      geometry: { type: "Polygon", coordinates: square(-84, lat) },
      properties: { block_id: block, style: "regular", levels: 2, height_meters: 6.4, base_elevation_meters: base, reference_block_id: null, count_source: "default", generated: true },
    }) as Feature<GeneratedBuildingProperties>;
  const withGenerated = { ...data, generated_buildings: fc([generated("g1", "b1", 10.0004), generated("g2", "b1", 10.0006), generated("g3", "b2", 10.0008)]) };
  const world = buildBatched(withGenerated);
  const chunks = (group: string) => world.getObjectByName(group)!.children as THREE.Mesh[];

  it("draws the observed buildings as chunks named for their cell and material, not as one mesh each", () => {
    expect(chunks("buildings").every((chunk) => /^buildings:chunk:/.test(chunk.name) && chunk.userData.layer === "building" && chunk.castShadow && chunk.receiveShadow)).toBe(true);
    expect(world.getObjectByName("building:bu1")).toBeUndefined();
    expect(chunks("buildings").flatMap((chunk) => chunk.userData.featureIds).sort()).toEqual(["bu1", "bu2"]);
  });

  it("keeps the defaulted and measured materials apart, even in one cell", () => {
    const byId = (id: string) => chunks("buildings").find((chunk) => chunk.userData.featureIds.includes(id))!;
    expect(byId("bu1").material).toBe(MATERIALS.buildingDefaulted);
    expect(byId("bu2").material).toBe(MATERIALS.buildingMeasured);
    expect(byId("bu1")).not.toBe(byId("bu2"));
  });

  it("gives each chunk one edges child in the edge material, and the generated ones the dashed material", () => {
    for (const chunk of chunks("buildings")) {
      const edges = chunk.children.filter((child) => child.name === "edges") as THREE.LineSegments[];
      expect(edges).toHaveLength(1);
      expect(edges[0].material).toBe(MATERIALS.edge);
    }
    for (const chunk of chunks("generated")) {
      const edges = chunk.getObjectByName("edges") as THREE.LineSegments;
      expect(edges.material).toBe(MATERIALS.edgeGenerated);
      expect(edges.geometry.getAttribute("lineDistance")).toBeDefined();
    }
  });

  it("merges the generated buildings of a block into one chunk, and keeps blocks apart", () => {
    expect(chunks("generated").map((chunk) => chunk.name)).toEqual(["generated:chunk:b1", "generated:chunk:b2"]);
    expect(chunks("generated").map((chunk) => chunk.userData.featureIds)).toEqual([["g1", "g2"], ["g3"]]);
    expect(chunks("generated").map((chunk) => chunk.userData.block)).toEqual(["b1", "b2"]);
    expect(chunks("generated").every((chunk) => chunk.userData.generated === true && chunk.material === MATERIALS.buildingGenerated)).toBe(true);
  });

  it("generatedMeshes falls back to the grid cell for a feature with no block", () => {
    const terrain = world.userData.terrain;
    const feature = generated("g1", "b1", 10.0004);
    const [chunk] = generatedMeshes([{ ...feature, properties: { ...feature.properties, block_id: undefined as never } }], terrain, data.projection);
    expect(chunk.name).toMatch(/^generated:chunk:cell:/);
    expect(chunk.userData.block).toBeUndefined();
  });

  it("keeps each feature's properties once in the world, and none on the meshes", () => {
    const features: Map<string, { height_meters: number | null }> = world.userData.features;
    expect(features.get("bu2")).toMatchObject({ height_meters: 12 });
    expect(features.get("g3")).toMatchObject({ block_id: "b2" });
    world.traverse((object) => expect(object.userData.properties).toBeUndefined());
  });

  it("still lists every footprint for walking", () => {
    expect(world.userData.footprints.map((footprint: { id: string }) => footprint.id)).toEqual(["bu1", "bu2"]);
  });

  it("stands each building on its base inside a chunk that sits at its lowest one", () => {
    const terrainWorld = buildBatched(terrainData);
    const bottoms = new Map<string, number>();
    for (const chunk of terrainWorld.getObjectByName("buildings")!.children as THREE.Mesh[]) {
      const position = chunk.geometry.getAttribute("position") as THREE.BufferAttribute;
      const starts: number[] = chunk.userData.triangleStarts;
      (chunk.userData.featureIds as string[]).forEach((id, i) => {
        let min = Infinity;
        for (let v = starts[i] * 3; v < starts[i + 1] * 3; v++) min = Math.min(min, position.getY(v));
        bottoms.set(id, chunk.position.y + min);
      });
    }
    expect(bottoms.get("bu1")).toBeCloseTo(7, 4); // the server's base: 57 m over the 50 m baseline
    expect(bottoms.get("bu2")).toBeCloseTo(10, 3); // the lowest ground under it
  });

  it("holds the same buildings as the per-feature world: same ids", () => {
    const flat = buildWorld(withGenerated);
    const ids = (group: string) => (flat.getObjectByName(group)!.children as THREE.Mesh[]).map((mesh) => mesh.userData.id).sort();
    expect(chunks("buildings").flatMap((chunk) => chunk.userData.featureIds).sort()).toEqual(ids("buildings"));
    expect(chunks("generated").flatMap((chunk) => chunk.userData.featureIds).sort()).toEqual(ids("generated"));
  });
});

describe("buildWorld batched roads, area features and blocks", () => {
  /** Features in one 150 m cell (lon -84), and one in the next cell east (lon -83.998, about 218 m on). */
  const west = -84;
  const east = -83.998;
  const parcel = (id: string, kind: string, lon: number, lat: number) => ({ type: "Feature" as const, id, geometry: { type: "Polygon" as const, coordinates: square(lon, lat) }, properties: { kind, import_area_id: "area-1" } });
  const blockAt = (id: string, lon: number, lat: number, extra: Record<string, unknown> = {}) => {
    const base = data.blocks.features[0];
    return { ...base, id, geometry: { type: "Polygon" as const, coordinates: square(lon, lat) }, properties: { ...base.properties, buildable_area: { type: "Polygon" as const, coordinates: square(lon, lat) }, ...extra } } as MapData["blocks"]["features"][number];
  };
  const chunks = (world: THREE.Object3D, group: string) => world.getObjectByName(group)!.children as THREE.Mesh[];
  const ids = (list: THREE.Object3D[]) => list.flatMap((chunk) => chunk.userData.featureIds ?? []).sort();
  const outlinesOf = (world: THREE.Object3D) => chunks(world, "blocks").filter((child) => child.userData.layer === "block_outline") as unknown as THREE.LineSegments[];

  const flat = buildBatched({
    ...data,
    road_segments: fc([
      road("r1", [[west, 10.0001], [west + 0.0004, 10.0001]], "s1"),
      road("r2", [[west, 10.0004], [west + 0.0004, 10.0004]], "s2"),
      road("r3", [[west, 10.0007], [west + 0.0004, 10.0007]], "s3", "wide"),
      road("r4", [[east, 10.0001], [east + 0.0004, 10.0001]], "s4"),
    ]),
    area_features: fc([parcel("a1", "park", west, 9.9998), parcel("a2", "park", west, 9.9996), parcel("a3", "water", west, 9.9994), parcel("a4", "park", east, 9.9998)]),
    blocks: fc([blockAt("b1", west, 10), blockAt("b2", west, 10.0003, { eligibility: "median", buildable_area: null }), blockAt("b3", east, 10), blockAt("b4", west, 10.0006)]),
    generation_zones: fc([
      { type: "Feature", id: "z1", geometry: { type: "Polygon", coordinates: square(west, 10.0009) }, properties: { block_id: "b1", reason: "water" } },
      { type: "Feature", id: "z2", geometry: { type: "Polygon", coordinates: square(west, 10.0011) }, properties: { block_id: "b1", reason: "water" } },
    ] as never),
  });

  it("merges the roads per cell and lane type: the object count follows the cells, not the roads", () => {
    const roads = chunks(flat, "roads");
    expect(roads).toHaveLength(3); // west normal (r1, r2), west wide (r3), east normal (r4): four roads
    expect(roads.every((chunk) => /^road:chunk:/.test(chunk.name) && chunk.userData.layer === "road" && chunk.receiveShadow && !chunk.castShadow)).toBe(true);
    expect(ids(roads)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(flat.getObjectByName("road:r1")).toBeUndefined();
  });

  it("keeps the road layer's height, order and material on each chunk", () => {
    for (const chunk of chunks(flat, "roads")) {
      const wide = (chunk.userData.featureIds as string[]).includes("r3");
      expect(chunk.position.y).toBe(LAYER_Y.roads);
      expect(chunk.renderOrder).toBe(wide ? LAYER_ORDER.roadWide : LAYER_ORDER.roadNormal);
      expect(chunk.material).toBe(wide ? MATERIALS.roadWide : MATERIALS.roadNormal);
    }
  });

  it("merges the area features per cell, material and draw order", () => {
    const features = chunks(flat, "area_features");
    expect(features).toHaveLength(3); // west park (a1, a2), west water (a3), east park (a4)
    expect(ids(features)).toEqual(["a1", "a2", "a3", "a4"]);
    for (const chunk of features) {
      const water = (chunk.userData.featureIds as string[]).includes("a3");
      expect(chunk.userData.layer).toBe("area_feature");
      expect(chunk.position.y).toBe(LAYER_Y.area_features);
      expect(chunk.renderOrder).toBe(water ? LAYER_ORDER.water : LAYER_ORDER.green);
      expect(chunk.material).toBe(water ? MATERIALS.water : MATERIALS.green);
    }
  });

  it("merges the block outlines per cell and kind into line segments, and the fills and zones per cell and material", () => {
    const blocks = chunks(flat, "blocks");
    const lines = outlinesOf(flat);
    expect(lines).toHaveLength(3); // west crisp (b1, b4), west faint (b2), east crisp (b3)
    for (const line of lines) {
      expect(line.isLineSegments).toBe(true);
      expect(line.geometry.getAttribute("lineDistance")).toBeDefined(); // the dashes show
      expect(line.geometry.getAttribute("position").count % 2).toBe(0);
      const hits: THREE.Intersection[] = [];
      line.raycast({} as THREE.Raycaster, hits);
      expect(hits).toEqual([]);
    }
    expect(new Set(lines.map((line) => line.material))).toEqual(new Set([MATERIALS.blockOutline, MATERIALS.blockOutlineFaint]));
    const fills = blocks.filter((child) => child.userData.layer === "block");
    expect(ids(fills)).toEqual(["b1", "b3", "b4"]); // the median has no fill
    expect(fills).toHaveLength(2);
    expect(fills.every((chunk) => chunk.position.y === LAYER_Y.blocks && chunk.renderOrder === LAYER_ORDER.blocks && chunk.material === MATERIALS.buildable)).toBe(true);
    const zones = blocks.filter((child) => child.userData.layer === "zone");
    expect(ids(zones)).toEqual(["z1", "z2"]);
    expect(zones).toHaveLength(1); // both in one cell, one material
    expect(zones[0].position.y).toBe(LAYER_Y.zones);
    expect(zones[0].renderOrder).toBe(LAYER_ORDER.zones);
    expect(flat.getObjectByName("blocks")!.visible).toBe(false);
  });

  it("draws the selected block's outline as an object of its own, and puts it back when deselected", () => {
    const verts = (lines: THREE.LineSegments[]) => lines.reduce((sum, line) => sum + line.geometry.getAttribute("position").count, 0);
    const total = verts(outlinesOf(flat));

    redrawBlockOutlines(flat, "b1");
    const selected = outlinesOf(flat).filter((line) => line.material === MATERIALS.blockOutlineSelected);
    expect(selected).toHaveLength(1);
    expect(selected[0].userData.kind).toBe("selected");
    expect(verts(outlinesOf(flat))).toBe(total); // the same outlines, b1's moved to its own object
    expect(outlinesOf(flat)).toHaveLength(4); // the west crisp one now holds only b4

    redrawBlockOutlines(flat, null);
    expect(outlinesOf(flat).some((line) => line.material === MATERIALS.blockOutlineSelected)).toBe(false);
    expect(outlinesOf(flat)).toHaveLength(3);
  });

  it("draws a block in the kind its feedback now gives it when the outlines are redrawn", () => {
    const world = buildBatched({ ...data, blocks: fc([blockAt("b1", west, 10)]) });
    expect(outlinesOf(world).map((line) => line.material)).toEqual([MATERIALS.blockOutline]);
    world.userData.blockIndex[0].properties = { ...world.userData.blockIndex[0].properties, is_reference: true };
    redrawBlockOutlines(world, null);
    expect(outlinesOf(world).map((line) => line.material)).toEqual([MATERIALS.blockOutlineReference]);
  });

  describe("on terrain", () => {
    // r1 and r4 share a cell and lane type, so one chunk holds both: r1 smoothed 10 / exact 0, r4 smoothed 30 / exact 20 above the baseline.
    const world = buildBatched({ ...terrainData, road_segments: fc([...terrainData.road_segments.features, withHeights(road("r4", [[-84, 10.0003], [-83.999, 10.0003]], "street-3"), [70, 70], [80, 80])]) });
    const chunkOf = (id: string) => chunks(world, "roads").find((chunk) => (chunk.userData.featureIds as string[]).includes(id))!;
    /** The heights of a road's own vertices within its chunk. */
    const heightsOf = (id: string) => {
      const chunk = chunkOf(id);
      const position = chunk.geometry.getAttribute("position");
      const i = (chunk.userData.featureIds as string[]).indexOf(id);
      const starts: number[] = chunk.userData.triangleStarts;
      return Array.from({ length: (starts[i + 1] - starts[i]) * 3 }, (_, k) => position.getY(starts[i] * 3 + k));
    };

    it("holds both road modes on the same chunks: each road is draped on its own heights, and switches in place", () => {
      expect(chunkOf("r1")).toBe(chunkOf("r4"));
      expect(chunkOf("r1")).not.toBe(chunkOf("r3"));
      const chunk = chunkOf("r1");
      const geometry = chunk.geometry;
      const count = geometry.getAttribute("position").count;
      heightsOf("r1").forEach((y) => expect(y).toBeCloseTo(10));
      heightsOf("r4").forEach((y) => expect(y).toBeCloseTo(30));

      setRoadMode(world, "exact");
      heightsOf("r1").forEach((y) => expect(y).toBeCloseTo(0));
      heightsOf("r4").forEach((y) => expect(y).toBeCloseTo(20));
      expect(world.userData.roadMode).toBe("exact");
      expect(chunk.geometry).toBe(geometry);
      expect(chunk.geometry.getAttribute("position").count).toBe(count);

      setRoadMode(world, "smoothed");
      heightsOf("r1").forEach((y) => expect(y).toBeCloseTo(10));
      heightsOf("r4").forEach((y) => expect(y).toBeCloseTo(30));
    });

    it("samples the terrain under a road with no stored heights, in either mode", () => {
      const before = heightsOf("r3");
      expect(Math.max(...before)).toBeGreaterThan(15);
      setRoadMode(world, "exact");
      expect(heightsOf("r3")).toEqual(before);
      setRoadMode(world, "smoothed");
    });

    it("builds in the exact mode when asked", () => {
      const exact = buildBatched(terrainData, "exact");
      const chunk = (exact.getObjectByName("roads")!.children as THREE.Mesh[]).find((c) => (c.userData.featureIds as string[]).includes("r1"))!;
      const array = chunk.geometry.getAttribute("position").array;
      for (let i = 1; i < array.length; i += 3) expect(array[i]).toBeCloseTo(0);
    });
  });
});
