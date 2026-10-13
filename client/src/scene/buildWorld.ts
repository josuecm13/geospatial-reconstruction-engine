import * as THREE from "three";
import type { Feature, GeneratedBuildingProperties, Geometry, MapData, Position, Projection } from "../api/types";
import { buildingHeights } from "./buildingHeight";
import { drapedGeometry, extrudeFootprints, flatGeometry, footprintShape, polygonShape } from "./extrude";
import { densify, hasBlockFill, insetRing, outlineKind } from "./blockOutline";
import { areaFeatureMaterial, MATERIALS, outlineMaterial, roadMaterial, zoneMaterial } from "./palette";
import { toLocal, type Local } from "./projection";
import { dedupeTwins, roadPolygon } from "./roadGeometry";
import { shadeGeometry } from "./shading";
import { clipPolygonToRect, clipRingToRect, createTerrain, drape, flatTerrain, groundMesh, roadSurface, splitByLines, ringInside, type RoadMode, type Terrain } from "./terrain";

/** The layer groups of a world, in order. `generated` holds the generated buildings (Milestone 11). */
export const WORLD_GROUPS = ["ground", "area_features", "roads", "blocks", "buildings", "generated"] as const;

/** Heights above the ground (y = 0) for flat layers. The scene view draws them by LAYER_ORDER instead; this
 * physical separation stays because glTF has no render order, so other viewers of the export need it. */
export const LAYER_Y = { area_features: 0.02, blocks: 0.03, zones: 0.035, roads: 0.05 } as const;

/** A block's outline floats this far above the ground, so it clears the road and area surfaces under it. */
export const OUTLINE_LIFT = 0.25;
/** A road outline floats this far above the road surface (on top of LAYER_Y.roads), so it clears the road's own triangles. */
const ROAD_OUTLINE_LIFT = 0.1;
/** How far apart a draped outline's vertices are when the world has no terrain (a flat line needs none in between). */
const FLAT_OUTLINE_STEP = 50;

/** Draw order of the ground-level layers, lowest first. Only the ground writes depth (palette.ts); the layers on it write none and depth-test with a polygon offset, so this order decides which of them shows on top of which. */
export const LAYER_ORDER = { ground: -50, green: -40, water: -39, roadNarrow: -30, roadNormal: -29, roadWide: -28, blocks: -20, zones: -19 } as const;

/** The ground plane over the given local extent. Shared by buildWorld and the staged build. */
export function groundPlane(minX: number, maxX: number, minZ: number, maxZ: number): THREE.Mesh {
  // The rotation is baked into the geometry: the shade can't see a mesh rotation (shading.ts).
  const ground = new THREE.Mesh(shadeGeometry(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).rotateX(-Math.PI / 2)), MATERIALS.ground);
  ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  ground.name = "ground:plane";
  ground.receiveShadow = true;
  ground.renderOrder = LAYER_ORDER.ground;
  return ground;
}

/** The ground over the given local extent, following the terrain: a mesh with a vertex on every grid line. */
export function terrainGround(terrain: Terrain, minX: number, maxX: number, minZ: number, maxZ: number): THREE.Mesh {
  const { positions, indices } = groundMesh(terrain, minX, maxX, minZ, maxZ);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const ground = new THREE.Mesh(shadeGeometry(geometry), MATERIALS.ground);
  ground.name = "ground:plane";
  ground.receiveShadow = true;
  ground.renderOrder = LAYER_ORDER.ground;
  return ground;
}

/** Roads follow the smoothed heights unless the viewer asks for the exact ones. */
export const DEFAULT_ROAD_MODE: RoadMode = "smoothed";

const GROUND_MARGIN = 20;
const DEFAULT_HALF_EXTENT = 100;

type Rings = Local[][];

/** The polygons of a Polygon / MultiPolygon, each as its rings in local meters. */
function polygonsOf(geometry: Geometry | null, projection: Projection): Rings[] {
  const project = (ring: Position[]) => ring.map((p) => toLocal(projection, p));
  if (geometry?.type === "Polygon") return [geometry.coordinates.map(project)];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates.map((polygon) => polygon.map(project));
  return [];
}

function linesOf(geometry: Geometry, projection: Projection): Local[][] {
  const project = (line: Position[]) => line.map((p) => toLocal(projection, p));
  if (geometry.type === "LineString") return [project(geometry.coordinates)];
  if (geometry.type === "MultiLineString") return geometry.coordinates.map(project);
  return [];
}

function entity(layer: string, feature: Feature<object>, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${layer}:${feature.id}`;
  mesh.userData = { layer, id: feature.id, properties: feature.properties };
  // Shadows (lit themes only; harmless otherwise): buildings cast and receive them, the ground layers receive.
  mesh.castShadow = layer === "building" || layer === "generated";
  mesh.receiveShadow = true;
  return mesh;
}

const group = (name: string) => Object.assign(new THREE.Group(), { name });

/** A building stands on the lowest ground under its footprint (or at its stored base height), so nothing floats. */
function standOnGround(terrain: Terrain, mesh: THREE.Mesh, polygons: Rings[], base: number | null | undefined): void {
  mesh.position.y = !terrain.hasGround ? 0 : base != null ? base - terrain.baseline : Math.min(...polygons.map((rings) => terrain.lowestUnder(rings[0])));
}

/** The pale outline of a building's edges: a child, so it follows the build animation's scale.y. Not pickable (routeLayer raycasts recursively) and left out of the glTF export (exportGltf.ts). */
function withEdges(mesh: THREE.Mesh, generated = false): void {
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 1), generated ? MATERIALS.edgeGenerated : MATERIALS.edge);
  if (generated) edges.computeLineDistances(); // the dashes (Blueprint) are measured along the line
  edges.name = "edges";
  edges.raycast = () => {};
  mesh.add(edges);
}

/**
 * One line object of every road's outline (`world.userData.roadOutlines`, in local metres), densified like the block outlines
 * and lifted onto the terrain plus the road layer plus a small lift. Named `road_outlines`, never picked. Blueprint only draws
 * it (the scene view builds it when that theme is first applied to a world and toggles `visible`); the caller adds it under `roads`.
 */
export function roadOutlineLines(world: THREE.Object3D): THREE.LineSegments {
  const terrain: Terrain | undefined = world.userData.terrain;
  const outlines: Local[][] = world.userData.roadOutlines ?? [];
  const step = terrain?.spacing || FLAT_OUTLINE_STEP;
  const lift = LAYER_Y.roads + ROAD_OUTLINE_LIFT;
  const positions: number[] = [];
  for (const outline of outlines) {
    const ring = densify([...outline, outline[0]], step); // a road polygon isn't closed
    for (let i = 0; i + 1 < ring.length; i++) {
      for (const p of [ring[i], ring[i + 1]]) positions.push(p.x, (terrain?.heightAtLocal(p.x, p.z) ?? 0) + lift, p.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, MATERIALS.roadOutline);
  lines.name = "road_outlines";
  lines.userData = { layer: "road_outline" };
  lines.raycast = () => {};
  return lines;
}

/**
 * The meshes of generated buildings, one per feature with a footprint: extruded to `height_meters` in the
 * generated material, standing on `base_elevation_meters` (minus the terrain's baseline), edges as a child,
 * named `generated:<id>` and tagged `userData.generated`. Shared by `buildWorld` and by the batches that
 * stream into a world while a run is being generated, so both look the same.
 */
export function generatedMeshes(features: Feature<GeneratedBuildingProperties>[], terrain: Terrain, projection: Projection): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const feature of features) {
    const polygons = polygonsOf(feature.geometry, projection);
    if (!polygons.length) continue;
    const shapes = polygons.map((rings) => footprintShape(rings[0]));
    const mesh = entity("generated", feature, extrudeFootprints(shapes, feature.properties.height_meters), MATERIALS.buildingGenerated);
    mesh.userData.generated = true;
    mesh.userData.height = feature.properties.height_meters;
    standOnGround(terrain, mesh, polygons, feature.properties.base_elevation_meters);
    withEdges(mesh, true);
    meshes.push(mesh);
  }
  return meshes;
}

/** Builds the low-poly world for a map-data response. See the World contract
 * (openspec/specs/showcase-client, and design.md of the archived change): meters from the projection origin, x east, z south, y up. */
export function buildWorld(data: MapData, roadMode: RoadMode = DEFAULT_ROAD_MODE): THREE.Group {
  const projection = data.projection;
  const terrain = data.elevation ? createTerrain(data.elevation, projection) : flatTerrain();
  const grid = terrain.extent();
  const gridLines = terrain.gridLines();
  /** On terrain, a polygon is cut to the grid first: past its edge heights only clamp, so nothing is gained by cutting it further out. */
  const clipped = (polygons: Rings[]): Rings[] => (grid ? polygons.map((rings) => clipPolygonToRect(rings, grid)).filter((rings): rings is Rings => rings !== null) : polygons);
  /** Flat polygons, over the terrain when the area has one. The layer's offset is the mesh's position.y. */
  const surface = (polygons: Rings[]): THREE.BufferGeometry => (gridLines ? drapedGeometry(polygons, terrain.heightAtLocal, gridLines) : flatGeometry(polygons.map(polygonShape)));
  const world = group("world");
  world.userData = {
    scope: data.scope,
    projection,
    attribution: data.attribution,
    terrain,
    roadMode,
    elevation: data.elevation && { source: data.elevation.source, version: data.elevation.version, attribution: data.elevation.attribution },
  };
  const groups = Object.fromEntries(WORLD_GROUPS.map((name) => [name, group(name)])) as Record<(typeof WORLD_GROUPS)[number], THREE.Group>;
  for (const name of WORLD_GROUPS) world.add(groups[name]);

  // Kept for walking (see collision.ts), so it doesn't re-parse meshes.
  const footprints: { id: string; ring: Local[] }[] = [];
  const roadOutlines: Local[][] = [];
  world.userData.footprints = footprints;
  world.userData.roadOutlines = roadOutlines;

  const extent = new THREE.Box2();
  const grow = (points: Local[]) => points.forEach((p) => extent.expandByPoint(new THREE.Vector2(p.x, p.z)));

  for (const feature of data.area_features.features) {
    const polygons = polygonsOf(feature.geometry, projection);
    if (!polygons.length) continue;
    polygons.forEach((rings) => grow(rings[0]));
    const drawn = clipped(polygons);
    if (!drawn.length) continue;
    const material = areaFeatureMaterial(feature.properties.kind);
    const mesh = entity("area_feature", feature, surface(drawn), material);
    mesh.position.y = LAYER_Y.area_features;
    mesh.renderOrder = feature.properties.kind === "water" ? LAYER_ORDER.water : LAYER_ORDER.green;
    groups.area_features.add(mesh);
  }

  const segments = data.road_segments.features
    .map((feature) => ({ feature, lines: linesOf(feature.geometry, projection) }))
    .filter((segment) => segment.lines.length);
  for (const { feature, lines } of dedupeTwins(segments, (s) => s.feature.properties.street.id, (s) => s.lines)) {
    lines.forEach(grow);
    const outlines = lines.map((line) => roadPolygon(line, feature.properties.width_meters)).filter((outline) => outline.length);
    if (!outlines.length) continue;
    roadOutlines.push(...outlines);
    // A road that runs past the grid is cut to it, like the area features, so its triangles stop there.
    const drawnOutlines = grid ? outlines.map((outline) => (ringInside(outline, grid) ? outline : clipRingToRect(outline, grid))).filter((outline) => outline.length) : outlines;
    if (!drawnOutlines.length) continue;
    // Both stored height arrays stay on the mesh, so the road mode can switch without a rebuild.
    const heights = {
      exact: splitByLines(terrain.roadHeights(feature, "exact"), lines),
      smoothed: splitByLines(terrain.roadHeights(feature, "smoothed"), lines),
    };
    const shapes = gridLines ? [] : drawnOutlines.map(footprintShape);
    const mesh = entity(
      "road",
      feature,
      gridLines ? drapedGeometry(drawnOutlines.map((outline) => [outline]), roadSurface(lines, heights[roadMode], terrain.heightAtLocal).at, gridLines) : flatGeometry(shapes),
      roadMaterial(feature.properties.lane_type),
    );
    if (terrain.hasGround) mesh.userData.drape = { lines, heights };
    mesh.position.y = LAYER_Y.roads;
    const laneType = feature.properties.lane_type;
    mesh.renderOrder = laneType === "wide" ? LAYER_ORDER.roadWide : laneType === "narrow" ? LAYER_ORDER.roadNarrow : LAYER_ORDER.roadNormal;
    groups.roads.add(mesh);
  }

  // Where each block is, for picking: a click on the ground finds its block by point-in-polygon (blockSelection.ts), so a
  // block with no buildable area (a median, a sliver) can still be selected.
  const blockIndex: { id: string; polygons: Rings[]; properties: MapData["blocks"]["features"][number]["properties"] }[] = [];
  world.userData.blockIndex = blockIndex;
  for (const feature of data.blocks.features) {
    // The block's outline: its boundary moved 1.5 m inward (blockOutline.ts), draped on the terrain, dashed by its eligibility.
    const outer = polygonsOf(feature.geometry, projection);
    if (outer.length) blockIndex.push({ id: feature.id, polygons: outer, properties: feature.properties });
    for (const rings of outer) {
      const inset = densify(insetRing(rings[0]), terrain.spacing || FLAT_OUTLINE_STEP);
      if (inset.length < 4) continue;
      const positions = new Float32Array(inset.length * 3);
      inset.forEach((p, i) => positions.set([p.x, terrain.heightAtLocal(p.x, p.z) + OUTLINE_LIFT, p.z], i * 3));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const kind = outlineKind(feature.properties);
      const line = new THREE.Line(geometry, outlineMaterial(kind));
      line.computeLineDistances(); // the dashes are measured along the line
      line.name = `block_outline:${feature.id}`;
      line.userData = { layer: "block_outline", id: feature.id, kind };
      line.raycast = () => {}; // never picked: selection goes through the ground (blockSelection.ts)
      groups.blocks.add(line);
    }
    // Only an eligible block is filled; the others keep just their faint outline (selection never needed the fill).
    if (!hasBlockFill(feature.properties)) continue;
    const polygons = polygonsOf(feature.properties.buildable_area, projection);
    if (!polygons.length) continue;
    const drawn = clipped(polygons);
    if (!drawn.length) continue;
    const mesh = entity("block", feature, surface(drawn), MATERIALS.buildable);
    mesh.position.y = LAYER_Y.blocks;
    mesh.renderOrder = LAYER_ORDER.blocks;
    groups.blocks.add(mesh);
  }
  // The zones where the last run kept buildings off (water, slope, land use, front setback), draped like the area features.
  for (const feature of data.generation_zones?.features ?? []) {
    const polygons = polygonsOf(feature.geometry, projection);
    if (!polygons.length) continue;
    const drawn = clipped(polygons);
    if (!drawn.length) continue;
    const mesh = entity("zone", feature, surface(drawn), zoneMaterial(feature.properties.reason));
    mesh.position.y = LAYER_Y.zones;
    mesh.renderOrder = LAYER_ORDER.zones;
    groups.blocks.add(mesh);
  }
  // Hidden by default; the scene view's "Show blocks" checkbox toggles it (the outlines, the faint buildable-area fill, and the zones).
  groups.blocks.visible = false;

  const buildingHeightList = buildingHeights(data.buildings.features);
  for (const [index, feature] of data.buildings.features.entries()) {
    const polygons = polygonsOf(feature.geometry, projection);
    if (!polygons.length) continue;
    polygons.forEach((rings) => {
      grow(rings[0]);
      footprints.push({ id: feature.id, ring: rings[0] });
    });
    const { height, defaulted } = buildingHeightList[index];
    // Footprints are single outer rings; any holes are ignored.
    const shapes = polygons.map((rings) => footprintShape(rings[0]));
    const material = defaulted ? MATERIALS.buildingDefaulted : MATERIALS.buildingMeasured;
    const mesh = entity("building", feature, extrudeFootprints(shapes, height), material);
    mesh.userData.defaulted = defaulted;
    mesh.userData.height = height;
    // Stands on the lowest ground under the footprint, so nothing floats. Its height and extrusion are unchanged.
    standOnGround(terrain, mesh, polygons, feature.properties.base_elevation_meters);
    withEdges(mesh);
    groups.buildings.add(mesh);
  }

  // Generated buildings (Milestone 11): a layer of their own, so they can be hidden, and are left out of the export while they are.
  const generated = data.generated_buildings?.features ?? [];
  for (const feature of generated) polygonsOf(feature.geometry, projection).forEach((rings) => grow(rings[0]));
  groups.generated.add(...generatedMeshes(generated, terrain, projection));

  // On terrain the ground is the grid (with the margin), not the union of every feature's envelope.
  const [minX, maxX, minZ, maxZ] = grid
    ? [grid.minX - GROUND_MARGIN, grid.maxX + GROUND_MARGIN, grid.minZ - GROUND_MARGIN, grid.maxZ + GROUND_MARGIN]
    : extent.isEmpty()
    ? [-DEFAULT_HALF_EXTENT, DEFAULT_HALF_EXTENT, -DEFAULT_HALF_EXTENT, DEFAULT_HALF_EXTENT]
    : [extent.min.x - GROUND_MARGIN, extent.max.x + GROUND_MARGIN, extent.min.y - GROUND_MARGIN, extent.max.y + GROUND_MARGIN];
  groups.ground.add(terrain.hasGround ? terrainGround(terrain, minX, maxX, minZ, maxZ) : groundPlane(minX, maxX, minZ, maxZ));
  return world;
}

/**
 * Switches every road of a world between its exact and smoothed heights, in place: the stored arrays
 * are read again and each road's vertices move; nothing is rebuilt. A world without terrain is unchanged.
 */
export function setRoadMode(world: THREE.Object3D, mode: RoadMode): void {
  const terrain: Terrain | undefined = world.userData.terrain;
  world.userData.roadMode = mode;
  if (!terrain?.hasGround) return;
  world.getObjectByName("roads")?.children.forEach((child) => {
    const mesh = child as THREE.Mesh;
    const stored = mesh.userData.drape as { lines: Local[][]; heights: Record<RoadMode, number[][] | null> } | undefined;
    if (!stored) return;
    const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    drape(position.array, roadSurface(stored.lines, stored.heights[mode], terrain.heightAtLocal).at);
    position.needsUpdate = true;
    shadeGeometry(mesh.geometry); // the slope changed, so the shade did
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
  });
}
