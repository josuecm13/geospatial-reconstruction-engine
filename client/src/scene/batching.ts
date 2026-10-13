import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BOX_STRIDE, boxesOf } from "./detail";
import { setBaseLift } from "./extrude";
import type { Local } from "./projection";

/** Side of a spatial grid cell, in local metres: a chunk of buildings spans at most this much, so the frustum and shadow culls still drop far ones. */
export const CHUNK_CELL = 150;

/** The grid cell holding local point (x, z), as a key like `3,-2`. */
export function cellKey(x: number, z: number, cell = CHUNK_CELL): string {
  return `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
}

/** The cell of a chunk from its `centres` (x, z, height per building, flat): the cell of their mean; `undefined` for none. */
export function cellOfCentres(centres: ArrayLike<number>, cell = CHUNK_CELL): string | undefined {
  const n = Math.floor(centres.length / 3);
  if (!n) return undefined;
  let [x, z] = [0, 0];
  for (let i = 0; i < n; i++) {
    x += centres[i * 3];
    z += centres[i * 3 + 1];
  }
  return cellKey(x / n, z / n, cell);
}

/** The middle of the bounding box of a footprint's rings. */
export function ringsCentre(rings: Local[][]): Local {
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const ring of rings) {
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

/** Items grouped by `keyOf`, groups in order of first appearance and items in their own order. */
export function groupByKey<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/**
 * The line segments of a footprint's outline as a prism: a ring at the bottom (`y0`), a ring at the top (`y1`), and a
 * vertical edge at every corner: 3n segments for n corners, 6 numbers (two x y z points) each, flat. A closing point
 * equal to the first is dropped. Stands in for `EdgesGeometry` without triangulating the building first (so every
 * corner of a curved wall is drawn, not only the sharp ones).
 */
export function footprintEdges(rings: Local[][], y0: number, y1: number): number[] {
  const out: number[] = [];
  for (const ring of rings) {
    const closed = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].z === ring[ring.length - 1].z;
    const n = closed ? ring.length - 1 : ring.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      out.push(a.x, y0, a.z, b.x, y0, b.z, a.x, y1, a.z, b.x, y1, b.z, a.x, y0, a.z, a.x, y1, a.z);
    }
  }
  return out;
}

/** One feature to be merged into a chunk. */
export interface BatchEntry {
  id: string;
  /** Which chunk it joins: entries with the same key merge into one mesh (the key says the material too). */
  key: string;
  material: THREE.Material;
  /** Extruded from y = 0 up to `height`, x and z in local metres. The merge moves it (in place) up by its own base. */
  geometry: THREE.BufferGeometry;
  /** Where it stands: the height of its base above y = 0. The chunk sits at the lowest one. */
  base: number;
  height: number;
  /** The outer rings of the footprint, for the edges and the centre. */
  rings: Local[][];
}

/** What a chunk mesh records (in `userData`) so a hit can be traced back to its feature. */
export interface ChunkIndex {
  /** The features in the order they were merged. */
  featureIds: string[];
  /** `featureIds.length + 1` triangle numbers: feature `i` owns triangles `[triangleStarts[i], triangleStarts[i + 1])`. */
  triangleStarts: number[];
  /** x, z, height of each feature, flat: three numbers per feature, in local metres. */
  centres: number[];
  /** The far-detail box of every outer ring, `BOX_STRIDE` numbers each (detail.ts): the minimum-area rectangle, its lift above the chunk's origin and its height. */
  boxes: number[];
}

const triangleCount = (geometry: THREE.BufferGeometry): number => (geometry.index ?? geometry.getAttribute("position")).count / 3;

/** The id of the feature that owns triangle `faceIndex` of a chunk (a raycast hit's `faceIndex`); `undefined` if out of range. */
export function featureAtFace(index: Pick<ChunkIndex, "featureIds" | "triangleStarts">, faceIndex: number | undefined): string | undefined {
  const { featureIds, triangleStarts } = index;
  if (faceIndex === undefined || faceIndex < 0 || faceIndex >= triangleStarts[triangleStarts.length - 1]) return undefined;
  let [lo, hi] = [0, featureIds.length - 1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (triangleStarts[mid] <= faceIndex) lo = mid;
    else hi = mid - 1;
  }
  return featureIds[lo];
}

export interface ChunkOptions {
  /** `userData.layer` of every chunk mesh. */
  layer: string;
  /** Chunk names are `<prefix>:chunk:<key>`. */
  prefix: string;
  /** The material of the edges child. */
  edgeMaterial: THREE.LineBasicMaterial;
  /** Measure line distances along the edges (the dashes of Blueprint's generated buildings). */
  dashed?: boolean;
  castShadow?: boolean;
  /** Extra `userData` for a chunk, from its key and entries. */
  extra?: (key: string, entries: BatchEntry[]) => Record<string, unknown>;
}

/**
 * Merges the entries into one mesh per key. A chunk's `position.y` is the lowest base of its entries and each entry is
 * moved up by its own base above that, so `scale.y` from 0 to 1 still reads as a rise from the ground. The edges are one
 * `LineSegments` child named `edges` (it follows `scale.y` and is never picked). The chunk's `userData` records `layer`,
 * `featureIds`, `triangleStarts`, `centres` and `boxes` (`ChunkIndex`). The entries' geometries are consumed.
 */
export function mergeChunks(entries: BatchEntry[], options: ChunkOptions): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const [key, group] of groupByKey(entries, (entry) => entry.key)) {
    let y = Infinity;
    for (const entry of group) y = Math.min(y, entry.base);
    const index: ChunkIndex = { featureIds: [], triangleStarts: [], centres: [], boxes: [] };
    const edges: number[] = [];
    let triangles = 0;
    for (const entry of group) {
      const lift = entry.base - y;
      entry.geometry.translate(0, lift, 0);
      setBaseLift(entry.geometry, lift);
      const centre = ringsCentre(entry.rings);
      index.featureIds.push(entry.id);
      index.triangleStarts.push(triangles);
      index.centres.push(centre.x, centre.z, entry.height);
      for (const value of boxesOf(entry.rings, lift, entry.height)) index.boxes.push(value);
      triangles += triangleCount(entry.geometry);
      for (const value of footprintEdges(entry.rings, lift, lift + entry.height)) edges.push(value);
    }
    index.triangleStarts.push(triangles);
    const geometry = group.length === 1 ? group[0].geometry : mergeGeometries(group.map((entry) => entry.geometry))!;
    if (group.length > 1) group.forEach((entry) => entry.geometry.dispose());
    const mesh = new THREE.Mesh(geometry, group[0].material);
    mesh.name = `${options.prefix}:chunk:${key}`;
    mesh.userData = { layer: options.layer, chunk: true, ...index, ...options.extra?.(key, group) };
    mesh.position.y = y;
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = true;
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
    const lines = new THREE.LineSegments(lineGeometry, options.edgeMaterial);
    if (options.dashed) lines.computeLineDistances();
    lines.name = "edges";
    lines.raycast = () => {};
    mesh.add(lines);
    meshes.push(mesh);
  }
  return meshes;
}

export interface FoldOptions {
  /** Chunk names are `<prefix>:chunk:<key>`. */
  prefix: string;
  /** Which merged chunk a chunk joins (the key says the material too). */
  keyOf: (chunk: THREE.Mesh) => string;
  /** The material of the merged edges child. */
  edgeMaterial: THREE.LineBasicMaterial;
  dashed?: boolean;
  /** Extra `userData` for a merged chunk, from its key and the chunks it replaces. */
  extra?: (key: string, chunks: THREE.Mesh[]) => Record<string, unknown>;
}

/** A merged chunk and the chunks it replaces: the caller swaps them in the scene (`foldChunks` has disposed what the replaced chunks no longer need). */
export interface Folded {
  replaced: THREE.Mesh[];
  chunk: THREE.Mesh;
}

/**
 * Merges chunks that `mergeChunks` made (at rest: unscaled, at x = z = 0) into one chunk per `keyOf`, keeping what a chunk
 * records: `featureIds`, `triangleStarts`, `centres`, `boxes` (their lift fields raised like `baseLift`), `blocks` (when every chunk has it), `baseLift` and one edges child. The
 * merged chunk sits at the lowest `position.y` of its chunks; the others are moved up by the difference, in their geometry, their
 * `baseLift` and their edges. The replaced chunks' geometries (edges included) are disposed, except a lone chunk's own, which the
 * renamed chunk keeps. A key held by one chunk already named for it is left alone.
 */
export function foldChunks(chunks: THREE.Mesh[], options: FoldOptions): Folded[] {
  const folded: Folded[] = [];
  for (const [key, group] of groupByKey(chunks, options.keyOf)) {
    const name = `${options.prefix}:chunk:${key}`;
    if (group.length === 1 && group[0].name === name) continue;
    let y = Infinity;
    for (const chunk of group) y = Math.min(y, chunk.position.y);
    const index: ChunkIndex = { featureIds: [], triangleStarts: [], centres: [], boxes: [] };
    const blocks: string[] = [];
    let hasBlocks = true;
    let triangles = 0;
    const edges: number[] = [];
    for (const chunk of group) {
      const lift = chunk.position.y - y;
      const { geometry } = chunk;
      const lifted = geometry.getAttribute("baseLift") as THREE.BufferAttribute;
      geometry.translate(0, lift, 0);
      for (let i = 0; i < lifted.count; i++) lifted.setX(i, lifted.getX(i) + lift);
      const data = chunk.userData as ChunkIndex & { blocks?: string[] };
      const starts = data.triangleStarts;
      data.featureIds.forEach((id, i) => {
        index.featureIds.push(id);
        index.triangleStarts.push(triangles + starts[i]);
      });
      triangles += starts[starts.length - 1];
      index.centres.push(...data.centres);
      for (let k = 0; k < data.boxes.length; k++) index.boxes.push(k % BOX_STRIDE === 5 ? data.boxes[k] + lift : data.boxes[k]);
      if (data.blocks) blocks.push(...data.blocks);
      else hasBlocks = false;
      const at = (chunk.getObjectByName("edges") as THREE.LineSegments | undefined)?.geometry.getAttribute("position");
      for (let i = 0; at && i < at.count; i++) edges.push(at.getX(i), at.getY(i) + lift, at.getZ(i));
    }
    index.triangleStarts.push(triangles);
    const geometry = group.length === 1 ? group[0].geometry : mergeGeometries(group.map((chunk) => chunk.geometry))!;
    const mesh = new THREE.Mesh(geometry, group[0].material);
    mesh.name = name;
    mesh.userData = { ...group[0].userData, block: undefined, ...index, ...(hasBlocks ? { blocks } : {}), ...options.extra?.(key, group) };
    mesh.position.y = y;
    mesh.castShadow = group[0].castShadow;
    mesh.receiveShadow = true;
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
    const lines = new THREE.LineSegments(lineGeometry, options.edgeMaterial);
    if (options.dashed) lines.computeLineDistances();
    lines.name = "edges";
    lines.raycast = () => {};
    mesh.add(lines);
    for (const chunk of group) {
      if (group.length > 1) chunk.geometry.dispose();
      (chunk.getObjectByName("edges") as THREE.LineSegments | undefined)?.geometry.dispose();
    }
    folded.push({ replaced: group, chunk: mesh });
  }
  return folded;
}

/** A material's key (`userData.key`, which `restyle` swaps by), else its uuid: what chunks of one material share in their grouping key. */
export const materialKey = (material: THREE.Material): string => String(material.userData.key ?? material.uuid);

/** One flat (ground-level) feature to be merged into a chunk: its geometry is already in local metres, with the layer's offset left to the chunk's `position.y`. */
export interface FlatEntry {
  id: string;
  /** Which chunk it joins: entries with the same key merge into one mesh (the key says the material, and anything else the chunk must share). */
  key: string;
  material: THREE.Material;
  /** Non-indexed with the same attributes as every other entry (`shadeGeometry` makes it so); consumed by the merge. */
  geometry: THREE.BufferGeometry;
}

export interface FlatOptions {
  /** `userData.layer` of every chunk mesh. */
  layer: string;
  /** Chunk names are `<prefix>:chunk:<key>`. */
  prefix: string;
  /** Sets what the chunk shares (`position.y`, `renderOrder`, `userData`), from its key and entries. */
  configure?: (mesh: THREE.Mesh, key: string, entries: FlatEntry[]) => void;
}

/**
 * Merges flat features into one mesh per key. A chunk's `userData` records `layer`, `featureIds` and `triangleStarts`
 * (`featureAtFace` reads them; the vertices of feature `i` are `triangleStarts[i] * 3` up to `triangleStarts[i + 1] * 3`, as the
 * geometries are non-indexed). Receives shadows; never casts them. The entries' geometries are consumed.
 */
export function mergeFlat(entries: FlatEntry[], options: FlatOptions): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const [key, group] of groupByKey(entries, (entry) => entry.key)) {
    const index: Pick<ChunkIndex, "featureIds" | "triangleStarts"> = { featureIds: [], triangleStarts: [] };
    let triangles = 0;
    for (const entry of group) {
      index.featureIds.push(entry.id);
      index.triangleStarts.push(triangles);
      triangles += triangleCount(entry.geometry);
    }
    index.triangleStarts.push(triangles);
    const geometry = group.length === 1 ? group[0].geometry : mergeGeometries(group.map((entry) => entry.geometry))!;
    if (group.length > 1) group.forEach((entry) => entry.geometry.dispose());
    const mesh = new THREE.Mesh(geometry, group[0].material);
    mesh.name = `${options.prefix}:chunk:${key}`;
    mesh.userData = { layer: options.layer, chunk: true, ...index };
    mesh.receiveShadow = true;
    options.configure?.(mesh, key, group);
    meshes.push(mesh);
  }
  return meshes;
}

/** One polyline to be merged into a line chunk: `positions` is flat x y z points, drawn as a strip. */
export interface StripEntry {
  key: string;
  material: THREE.LineBasicMaterial;
  positions: ArrayLike<number>;
}

/** The grid cell holding the middle of a flat polyline's bounding box. */
export function stripCell(positions: ArrayLike<number>): string {
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  return cellKey((minX + maxX) / 2, (minZ + maxZ) / 2);
}

/**
 * Merges polylines into one `LineSegments` per key (each strip becomes its consecutive point pairs). Named `<prefix>:chunk:<key>`,
 * `userData.layer` as given and never picked. Line distances are measured per segment, so the dashes of a dashed material start
 * afresh at every segment.
 */
export function mergeStrips(entries: StripEntry[], options: Pick<FlatOptions, "layer" | "prefix"> & { extra?: (key: string, entries: StripEntry[]) => Record<string, unknown> }): THREE.LineSegments[] {
  const lines: THREE.LineSegments[] = [];
  for (const [key, group] of groupByKey(entries, (entry) => entry.key)) {
    const positions: number[] = [];
    for (const { positions: strip } of group) {
      for (let i = 0; i + 5 < strip.length; i += 3) positions.push(strip[i], strip[i + 1], strip[i + 2], strip[i + 3], strip[i + 4], strip[i + 5]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const line = new THREE.LineSegments(geometry, group[0].material);
    line.computeLineDistances(); // the dashes are measured along the line
    line.name = `${options.prefix}:chunk:${key}`;
    line.userData = { layer: options.layer, chunk: true, ...options.extra?.(key, group) };
    line.raycast = () => {};
    lines.push(line);
  }
  return lines;
}
