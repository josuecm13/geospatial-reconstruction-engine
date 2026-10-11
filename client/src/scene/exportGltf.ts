import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { themeById } from "./themes";
import { FACADE_REPEAT_METRES, GROUND_TILE_METRES } from "./themes/textures";
import type { ThemeId, TimeOfDay } from "./themes/types";
import { groundCoords, wallCoords } from "./wallGrid";

export const GENERATOR = "geospatial-reconstruction-engine";
export const ATTRIBUTION = "© OpenStreetMap contributors";
export const AXES = "x east, y up, z south; meters";

/** The credit the file carries: OSM's, and the terrain source's when the world has terrain. */
function credit(world: THREE.Object3D): string {
  const { attribution, elevation } = world.userData;
  return [attribution ?? ATTRIBUTION, elevation?.attribution].filter(Boolean).join(" · ");
}

/** The root node's `extras`: where the world is, how to place it on the globe, and its credit. With terrain, the
 * grid's `version` and the road mode on show (the roads in the file are draped on that mode's heights) go along. */
function metadata(world: THREE.Object3D) {
  const { scope, projection, attribution, elevation, roadMode } = world.userData;
  return {
    generator: GENERATOR,
    scope,
    projection: {
      origin: projection?.origin,
      meters_per_degree_latitude: projection?.meters_per_degree_latitude,
      meters_per_degree_longitude: projection?.meters_per_degree_longitude,
    },
    attribution: attribution ?? ATTRIBUTION,
    axes: AXES,
    ...(elevation ? { elevation: { source: elevation.source, version: elevation.version, attribution: elevation.attribution, road_mode: roadMode } } : {}),
  };
}

/** How the scene looked when it was exported; both go into the root `extras`. */
export interface ExportOptions {
  theme: ThemeId;
  timeOfDay: TimeOfDay;
}

/** The ground texture of each Realistic ground material key, for the tile size its UVs are measured in. */
const GROUND_TEXTURE_BY_KEY: Record<string, keyof typeof GROUND_TILE_METRES> = {
  green: "grass",
  water: "water",
  forest: "forest",
  roadNormal: "asphalt",
  roadWide: "asphalt",
  roadNarrow: "asphalt",
};

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/**
 * The UVs Realistic's shaders compute on the GPU, baked for the file (glTF has one UV set per material). Ground layers
 * use world x and z over their tile (`groundCoords`); building walls use `wallCoords` over FACADE_REPEAT_METRES. Roofs
 * would use another texture in the viewer; the file has one map per material, so roofs take the facade map too, with
 * world x and z over the same repeat.
 */
function bakeUv(mesh: THREE.Mesh, material: THREE.Material): THREE.BufferAttribute {
  const { geometry } = mesh;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const textureKey = GROUND_TEXTURE_BY_KEY[material.userData.key];
  const tile = textureKey && GROUND_TILE_METRES[textureKey];
  const uv = new Float32Array(position.count * 2);
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    if (tile) {
      point.applyMatrix4(mesh.matrixWorld);
      const { u, v } = groundCoords(point.x, point.z, tile);
      uv.set([u, v], i * 2);
      continue;
    }
    const wall = normal && wallCoords(point.x, point.y, point.z, normal.getX(i), normal.getY(i), normal.getZ(i));
    const [u, v] = wall ? [wall.u / FACADE_REPEAT_METRES.u, wall.v / FACADE_REPEAT_METRES.v] : [point.x / FACADE_REPEAT_METRES.u, point.z / FACADE_REPEAT_METRES.v];
    uv.set([u, v], i * 2);
  }
  return new THREE.BufferAttribute(uv, 2);
}

/**
 * Exports the world group (and nothing else: no lights, markers, or placeholder) as a binary glTF, the way the active
 * theme shows it. The root `extras` carry the theme's id and the time of day. Node names stay `<layer>:<id>`.
 *
 * - Night clay: unlit (`KHR_materials_unlit`), the baked shade as `COLOR_0`, no normals, no UVs, every line left out.
 * - Light clay and Realistic: lit materials. three's exporter writes `MeshLambertMaterial` as metallic-roughness
 *   (roughness 1, metalness 0) with its colour, map and opacity, so they go as they are; normals stay, and `COLOR_0` is
 *   dropped (lit materials ignore vertex colours).
 * - Realistic: the facade, roof and ground textures are `DataTexture`s, which the exporter writes as PNG images through a
 *   canvas. Meshes with a map get UVs baked for the file (see `bakeUv`); roofs use the facade map. Night windows, the sky
 *   and the shadows are not in the file.
 * - Blueprint: building edges (generated ones too) and the road outlines are line primitives, as unlit materials; dashes
 *   become solid lines. Block outlines stay out, and the translucent fills keep their opacity.
 *
 * The exporter writes `userData` into `extras`, so for the export the world carries the metadata and each mesh only
 * `layer` and `id`. Everything changed for the export (userData, attributes, materials, visibility) is put back afterwards.
 */
export async function exportWorld(world: THREE.Group, options: ExportOptions): Promise<ArrayBuffer> {
  const meta = { ...metadata(world), theme: options.theme, time_of_day: options.timeOfDay };
  const mode = themeById(options.theme).mode;
  const undo: (() => void)[] = [];
  const seen = new Set<THREE.BufferGeometry>();
  world.updateMatrixWorld(true);
  world.traverse((object) => {
    const { userData } = object;
    undo.push(() => (object.userData = userData));
    if (object === world) object.userData = meta;
    else if ((object as THREE.Mesh).isMesh) {
      const { layer, id } = userData;
      object.userData = { layer, id };
    }

    const line = object as THREE.Line;
    if (line.isLine && object.visible) {
      const material = line.material as THREE.LineBasicMaterial;
      if (mode === "line" && (object.name === "edges" || object.name === "road_outlines") && !Array.isArray(material)) {
        // A line primitive with an unlit material; a dashed line goes out solid.
        const unlit = new THREE.MeshBasicMaterial({ color: material.color, transparent: material.transparent, opacity: material.opacity });
        line.material = unlit;
        undo.push(() => {
          line.material = material;
          unlit.dispose();
        });
      } else {
        // Edges, block outlines and the like are viewer effects; `onlyVisible` skips what is hidden.
        object.visible = false;
        undo.push(() => (object.visible = true));
      }
    }

    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || seen.has(mesh.geometry)) return;
    seen.add(mesh.geometry);
    const { geometry } = mesh;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshBasicMaterial[];
    const swap = (name: string, replacement: Attribute | undefined) => {
      const original = geometry.getAttribute(name) as Attribute | undefined;
      if (!original && !replacement) return;
      if (replacement) geometry.setAttribute(name, replacement as THREE.BufferAttribute);
      else geometry.deleteAttribute(name);
      undo.push(() => (original ? geometry.setAttribute(name, original as THREE.BufferAttribute) : geometry.deleteAttribute(name)));
    };
    // UVs only where a material has a map (Realistic); everywhere else they are dead weight.
    const mapped = materials.find((m) => m.map);
    swap("uv", mapped ? bakeUv(mesh, mapped) : undefined);
    // Unlit materials ignore normals (a viewer computes flat ones, as the spec says); lit ones need them.
    if (materials.every((m) => m.isMeshBasicMaterial)) swap("normal", undefined);
    // A material without vertex colours must not get `COLOR_0`: viewers multiply it in whether or not it was meant.
    if (materials.every((m) => !m.vertexColors)) swap("color", undefined);
  });
  try {
    // `copyright` sets asset.copyright (GLTFExporter's own option in this three.js version).
    const result = await new GLTFExporter().parseAsync(world, { binary: true, onlyVisible: true, copyright: credit(world) });
    return result as ArrayBuffer;
  } finally {
    undo.reverse().forEach((fn) => fn());
  }
}

/** `gre-<scope type>-<first 8 of the scope id>.glb`. */
export function glbFileName(scope: { type: string; id: string } | undefined): string {
  return scope ? `gre-${scope.type}-${scope.id.slice(0, 8)}.glb` : "gre-scene.glb";
}

/** Saves the buffer through a temporary `<a download>`. */
export function downloadGlb(buffer: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
