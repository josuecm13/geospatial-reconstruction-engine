import * as THREE from "three";
import type { Feature, Geometry, MapData, Position, Projection } from "../api/types";
import { buildingHeight } from "./buildingHeight";
import { drapedGeometry, extrudeFootprints, flatGeometry, footprintShape, polygonShape } from "./extrude";
import { MATERIALS, roadMaterial } from "./palette";
import { toLocal, type Local } from "./projection";
import { dedupeTwins, roadPolygon } from "./roadGeometry";
import { shadeGeometry } from "./shading";
import { createTerrain, drape, flatTerrain, groundMesh, maxEdgeFor, roadSurface, splitByLines, subdivideRing, type RoadMode, type Terrain } from "./terrain";

/** The layer groups of a world, in order. `generated` is reserved for Milestone 11. */
export const WORLD_GROUPS = ["ground", "area_features", "roads", "blocks", "buildings", "generated"] as const;

/** Heights above the ground (y = 0) for flat layers. The scene view draws them by LAYER_ORDER instead; this
 * physical separation stays because glTF has no render order, so other viewers of the export need it. */
export const LAYER_Y = { area_features: 0.02, blocks: 0.03, roads: 0.05 } as const;

/** Draw order of the ground-level layers, lowest first. They write no depth (palette.ts), so this order alone decides what shows on top. */
export const LAYER_ORDER = { ground: -50, green: -40, water: -39, roadNarrow: -30, roadNormal: -29, roadWide: -28, blocks: -20 } as const;

/** The ground plane over the given local extent. Shared by buildWorld and the staged build. */
export function groundPlane(minX: number, maxX: number, minZ: number, maxZ: number): THREE.Mesh {
  // The rotation is baked into the geometry: the shade can't see a mesh rotation (shading.ts).
  const ground = new THREE.Mesh(shadeGeometry(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).rotateX(-Math.PI / 2)), MATERIALS.ground);
  ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  ground.name = "ground:plane";
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
  return mesh;
}

const group = (name: string) => Object.assign(new THREE.Group(), { name });

/** Builds the low-poly world for a map-data response. See the World contract
 * (openspec/specs/showcase-client, and design.md of the archived change): meters from the projection origin, x east, z south, y up. */
export function buildWorld(data: MapData, roadMode: RoadMode = DEFAULT_ROAD_MODE): THREE.Group {
  const projection = data.projection;
  const terrain = data.elevation ? createTerrain(data.elevation, projection) : flatTerrain();
  const maxEdge = maxEdgeFor(terrain);
  /** Flat polygons, over the terrain when the area has one. The layer's offset is the mesh's position.y. */
  const surface = (polygons: Rings[]): THREE.BufferGeometry =>
    terrain.hasGround
      ? drapedGeometry(polygons.map((rings) => polygonShape(rings.map((ring) => subdivideRing(ring, maxEdge)))), terrain.heightAtLocal, maxEdge)
      : flatGeometry(polygons.map(polygonShape));
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
    const material = feature.properties.kind === "water" ? MATERIALS.water : MATERIALS.green;
    const mesh = entity("area_feature", feature, surface(polygons), material);
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
    // Both stored height arrays stay on the mesh, so the road mode can switch without a rebuild.
    const heights = {
      exact: splitByLines(terrain.roadHeights(feature, "exact"), lines),
      smoothed: splitByLines(terrain.roadHeights(feature, "smoothed"), lines),
    };
    const shapes = outlines.map(footprintShape);
    const mesh = entity(
      "road",
      feature,
      terrain.hasGround ? drapedGeometry(shapes, roadSurface(lines, heights[roadMode], terrain.heightAtLocal).at, maxEdge) : flatGeometry(shapes),
      roadMaterial(feature.properties.lane_type),
    );
    if (terrain.hasGround) mesh.userData.drape = { lines, heights };
    mesh.position.y = LAYER_Y.roads;
    const laneType = feature.properties.lane_type;
    mesh.renderOrder = laneType === "wide" ? LAYER_ORDER.roadWide : laneType === "narrow" ? LAYER_ORDER.roadNarrow : LAYER_ORDER.roadNormal;
    groups.roads.add(mesh);
  }

  for (const feature of data.blocks.features) {
    const polygons = polygonsOf(feature.properties.buildable_area, projection);
    if (!polygons.length) continue;
    const mesh = entity("block", feature, surface(polygons), MATERIALS.buildable);
    mesh.position.y = LAYER_Y.blocks;
    mesh.renderOrder = LAYER_ORDER.blocks;
    groups.blocks.add(mesh);
  }
  // Hidden by default; the scene view's "Show buildable area" checkbox toggles it.
  groups.blocks.visible = false;

  for (const feature of data.buildings.features) {
    const polygons = polygonsOf(feature.geometry, projection);
    if (!polygons.length) continue;
    polygons.forEach((rings) => {
      grow(rings[0]);
      footprints.push({ id: feature.id, ring: rings[0] });
    });
    const { height, defaulted } = buildingHeight(feature.properties);
    // Footprints are single outer rings; any holes are ignored.
    const shapes = polygons.map((rings) => footprintShape(rings[0]));
    const material = defaulted ? MATERIALS.buildingDefaulted : MATERIALS.buildingMeasured;
    const mesh = entity("building", feature, extrudeFootprints(shapes, height), material);
    mesh.userData.defaulted = defaulted;
    mesh.userData.height = height;
    // Stands on the lowest ground under the footprint, so nothing floats. Its height and extrusion are unchanged.
    const base = feature.properties.base_elevation_meters;
    mesh.position.y = !terrain.hasGround ? 0 : base != null ? base - terrain.baseline : Math.min(...polygons.map((rings) => terrain.lowestUnder(rings[0])));
    // A child, so it follows the build animation's scale.y. Not pickable (routeLayer raycasts recursively) and left out of the glTF export (exportGltf.ts).
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 1), MATERIALS.edge);
    edges.name = "edges";
    edges.raycast = () => {};
    mesh.add(edges);
    groups.buildings.add(mesh);
  }

  const [minX, maxX, minZ, maxZ] = extent.isEmpty()
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
