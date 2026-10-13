import * as THREE from "three";
import { cellOfCentres, materialKey } from "./batching";
import { appendBoxes, DETAIL_INTERVAL_MS, detailLevel, projectedRadius, superKey, type DetailLevel } from "./detail";
import { MATERIALS } from "./palette";
import { shadeGeometry } from "./shading";

/** The layer groups whose chunks have levels. */
const LAYERS = ["buildings", "generated"] as const;
type Layer = (typeof LAYERS)[number];

/** What one chunk contributes: its cell (from `userData.cell`, else the mean of its `centres`) and its bounds in world space. */
interface ChunkInfo {
  chunk: THREE.Mesh;
  layer: Layer;
  cell: string;
  box: THREE.Box3;
  /** Whether it kept the rectangles its far boxes are built from. */
  boxable: boolean;
}

interface Cell {
  chunks: ChunkInfo[];
  bounds: THREE.Box3;
}

/** A super-cell's far boxes of one layer and material, and the chunks they were built from. */
interface FarBoxes {
  mesh: THREE.Mesh;
  signature: string;
}

interface DetailState {
  /** The level each cell had at the last pass (before the super-cell rule), for the hysteresis. */
  levels: Map<string, DetailLevel>;
  boxes: Map<string, FarBoxes>;
  holder: THREE.Group;
  last: number;
}

const states = new WeakMap<THREE.Object3D, DetailState>();

const scratch = new THREE.Vector3();

function stateOf(world: THREE.Object3D): DetailState {
  let state = states.get(world);
  if (!state) {
    const holder = new THREE.Group();
    holder.name = "detail";
    holder.userData = { layer: "detail" };
    world.add(holder);
    state = { levels: new Map(), boxes: new Map(), holder, last: -Infinity };
    states.set(world, state);
  }
  return state;
}

/** A chunk's cell: the one its builder recorded in `userData.cell`, else that of the mean of its building centres. */
function cellOf(chunk: THREE.Object3D): string | undefined {
  return (chunk.userData.cell as string | undefined) ?? cellOfCentres((chunk.userData.centres as number[] | undefined) ?? []);
}

/** The material a far box wears: the chunk's, as the theme's current one (a fade in flight leaves a clone on the chunk). */
function themed(material: THREE.Material): THREE.Material {
  const key = material.userData.key as keyof typeof MATERIALS | undefined;
  return (key && MATERIALS[key]) || material;
}

/** The merged boxes of `chunks` (one layer, one material, one super-cell): 12 triangles a building, shaded, with each building's `baseLift`, at the world's origin. */
function boxMesh(chunks: ChunkInfo[], name: string): THREE.Mesh {
  const positions: number[] = [];
  const lifts: number[] = [];
  for (const { chunk } of chunks) appendBoxes(positions, lifts, chunk.userData.boxes as number[], chunk.position.y);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  shadeGeometry(geometry);
  geometry.setAttribute("baseLift", new THREE.Float32BufferAttribute(lifts, 1));
  const mesh = new THREE.Mesh(geometry, themed(chunks[0].chunk.material as THREE.Material));
  mesh.name = name;
  mesh.userData = { layer: "detail_box" };
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.raycast = () => {}; // buildings are never picked
  return mesh;
}

const setVisible = (object: THREE.Object3D, visible: boolean): boolean => {
  if (object.visible === visible) return false;
  object.visible = visible;
  return true;
};

/**
 * Gives every 150 m cell of a batched world the level its size on screen calls for (`detailLevel`, with hysteresis) and
 * applies it to its building chunks, observed and generated:
 * - `near`: full chunks with their edges;
 * - `mid`: full chunks without edges, and no block outlines;
 * - `far`: no chunks; each super-cell of 4 x 4 cells whose cells are all `far` shows its boxes instead (every building as
 *   its minimum-area rectangle, one mesh per layer and material, no shadow, no edges), built the first time it is wanted
 *   and kept (rebuilt only if its chunks changed). A super-cell with any cell not `far` keeps its far cells at `mid`.
 * A cell with a chunk still rising (`scale.y` under 1), or one without boxes, is never `far`. Roads and areas are untouched.
 * Runs at most every `DETAIL_INTERVAL_MS` (it is meant to be called every frame). Returns whether what casts shadows changed.
 */
export function applyDetail(world: THREE.Object3D, camera: THREE.PerspectiveCamera, viewportHeight: number, now = performance.now()): boolean {
  if (now - (states.get(world)?.last ?? -Infinity) < DETAIL_INTERVAL_MS) return false;
  const layers = LAYERS.map((name) => ({ name, group: world.getObjectByName(name) })).filter((layer): layer is { name: Layer; group: THREE.Object3D } => !!layer.group);
  if (!layers.length) return false;
  const state = stateOf(world);
  state.last = now;

  // Each chunk to its cell, and the cell's bounds.
  const cells = new Map<string, Cell>();
  for (const { name, group } of layers) {
    for (const child of group.children) {
      const chunk = child as THREE.Mesh;
      if (!chunk.isMesh || !chunk.userData.chunk) continue;
      const cell = cellOf(chunk);
      if (cell === undefined) continue;
      if (!chunk.geometry.boundingBox) chunk.geometry.computeBoundingBox();
      const box = chunk.geometry.boundingBox!.clone().translate(chunk.position);
      const entry = cells.get(cell) ?? { chunks: [], bounds: new THREE.Box3() };
      entry.chunks.push({ chunk, layer: name, cell, box, boxable: Array.isArray(chunk.userData.boxes) });
      entry.bounds.union(box);
      cells.set(cell, entry);
    }
  }

  // The level each cell's size on screen calls for.
  const wanted = new Map<string, DetailLevel>();
  for (const [key, cell] of cells) {
    const radius = cell.bounds.getBoundingSphere(new THREE.Sphere()).radius;
    const distance = cell.bounds.getCenter(scratch).distanceTo(camera.position);
    let level = detailLevel(projectedRadius(radius, distance, viewportHeight, camera.fov), state.levels.get(key));
    if (level === "far" && cell.chunks.some(({ chunk, boxable }) => !boxable || chunk.scale.y !== 1)) level = "mid"; // rising chunks stay full; so does what has no boxes
    wanted.set(key, level);
  }
  state.levels = wanted;

  // A super-cell shows its boxes only when all its cells are far; otherwise its far cells stay mid.
  const supers = new Map<string, string[]>();
  for (const key of cells.keys()) supers.set(superKey(key), [...(supers.get(superKey(key)) ?? []), key]);
  const whole = new Set([...supers].filter(([, keys]) => keys.every((key) => wanted.get(key) === "far")).map(([key]) => key));
  const levelOf = (key: string): DetailLevel => (wanted.get(key) === "far" && !whole.has(superKey(key)) ? "mid" : wanted.get(key)!);

  let changed = false;
  for (const [key, cell] of cells) {
    const level = levelOf(key);
    for (const { chunk } of cell.chunks) {
      if (chunk.scale.y !== 1) continue; // the animator owns a rising chunk
      changed = setVisible(chunk, level !== "far") || changed;
      const edges = chunk.getObjectByName("edges");
      if (edges) setVisible(edges, level === "near");
    }
  }

  // The far boxes: one mesh per (layer, super-cell, material), built when first wanted.
  const live = new Set<string>();
  for (const [sup, keys] of supers) {
    for (const { name, group } of layers) {
      const byMaterial = new Map<string, ChunkInfo[]>();
      for (const key of keys) for (const info of cells.get(key)!.chunks) if (info.layer === name) byMaterial.set(materialKey(info.chunk.material as THREE.Material), [...(byMaterial.get(materialKey(info.chunk.material as THREE.Material)) ?? []), info]);
      for (const [material, chunks] of byMaterial) {
        const id = `${name}|${sup}|${material}`;
        live.add(id);
        let boxes = state.boxes.get(id);
        if (whole.has(sup)) {
          const signature = chunks.map(({ chunk }) => chunk.uuid).sort().join();
          if (boxes && boxes.signature !== signature) {
            state.holder.remove(boxes.mesh);
            boxes.mesh.geometry.dispose();
            boxes = undefined;
          }
          if (!boxes) {
            boxes = { mesh: boxMesh(chunks, `detail:box:${id}`), signature };
            state.boxes.set(id, boxes);
            state.holder.add(boxes.mesh);
          }
        }
        if (boxes) changed = setVisible(boxes.mesh, whole.has(sup) && group.visible) || changed;
      }
    }
  }
  for (const [id, boxes] of state.boxes) {
    if (live.has(id)) continue;
    changed = boxes.mesh.visible || changed;
    state.holder.remove(boxes.mesh);
    boxes.mesh.geometry.dispose();
    state.boxes.delete(id);
  }

  // Block outlines are drawn near only.
  for (const outline of world.getObjectByName("blocks")?.children ?? []) {
    const cell = outline.userData.cell as string | undefined;
    if (outline.userData.layer === "block_outline" && cell !== undefined && wanted.has(cell)) outline.visible = wanted.get(cell) === "near";
  }
  return changed;
}
