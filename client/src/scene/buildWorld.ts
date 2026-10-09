import * as THREE from "three";
import type { Feature, Geometry, MapData, Position, Projection } from "../api/types";
import { buildingHeight } from "./buildingHeight";
import { extrudeFootprints, flatGeometry, footprintShape, polygonShape } from "./extrude";
import { MATERIALS, roadMaterial } from "./palette";
import { toLocal, type Local } from "./projection";
import { dedupeTwins, roadPolygon } from "./roadGeometry";
import { shadeGeometry } from "./shading";

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
export function buildWorld(data: MapData): THREE.Group {
  const projection = data.projection;
  const world = group("world");
  world.userData = { scope: data.scope, projection, attribution: data.attribution };
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
    const mesh = entity("area_feature", feature, flatGeometry(polygons.map(polygonShape)), material);
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
    const mesh = entity("road", feature, flatGeometry(outlines.map(footprintShape)), roadMaterial(feature.properties.lane_type));
    mesh.position.y = LAYER_Y.roads;
    const laneType = feature.properties.lane_type;
    mesh.renderOrder = laneType === "wide" ? LAYER_ORDER.roadWide : laneType === "narrow" ? LAYER_ORDER.roadNarrow : LAYER_ORDER.roadNormal;
    groups.roads.add(mesh);
  }

  for (const feature of data.blocks.features) {
    const polygons = polygonsOf(feature.properties.buildable_area, projection);
    if (!polygons.length) continue;
    const mesh = entity("block", feature, flatGeometry(polygons.map(polygonShape)), MATERIALS.buildable);
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
    groups.buildings.add(mesh);
  }

  const [minX, maxX, minZ, maxZ] = extent.isEmpty()
    ? [-DEFAULT_HALF_EXTENT, DEFAULT_HALF_EXTENT, -DEFAULT_HALF_EXTENT, DEFAULT_HALF_EXTENT]
    : [extent.min.x - GROUND_MARGIN, extent.max.x + GROUND_MARGIN, extent.min.y - GROUND_MARGIN, extent.max.y + GROUND_MARGIN];
  groups.ground.add(groundPlane(minX, maxX, minZ, maxZ));
  return world;
}
