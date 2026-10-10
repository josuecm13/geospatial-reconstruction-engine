import type { Elevation, Feature, Position, Projection, RoadSegmentProperties } from "../api/types";
import { toLonLat, type Local } from "./projection";

/** Which of a segment's two stored height arrays the roads follow. */
export type RoadMode = "exact" | "smoothed";

/**
 * The ground of a world. Every height the scene uses comes from here, so a world without terrain
 * (`flatTerrain`) needs no null checks: it answers 0 everywhere.
 *
 * Heights are metres above sea level (`heightAtLonLat`) or, in the scene, above the grid's lowest
 * point (`baseline`), so the world stays near y = 0 and the camera framing keeps working.
 */
export interface Terrain {
  /** False for `flatTerrain`. */
  readonly hasGround: boolean;
  /** The grid's minimum height, metres above sea level. Every y in the world is `height - baseline`. */
  readonly baseline: number;
  /** The grid's cell size in meters (the smaller of the two axes); 0 when flat. */
  readonly spacing: number;
  /** Metres above sea level at [lon, lat]: bilinear on the grid, clamped at its edges. */
  heightAtLonLat(position: Position): number;
  /** The scene's y of the ground at local (x, z): `heightAtLonLat` minus the baseline. */
  heightAtLocal(x: number, z: number): number;
  /** The segment's stored heights in the mode, as scene y (baseline removed), or null when it has none. */
  roadHeights(feature: Feature<RoadSegmentProperties>, mode: RoadMode): number[] | null;
  /** The lowest scene y of the ground under a footprint: its vertices and every grid point inside it. */
  lowestUnder(ring: Local[]): number;
  /** Local x of each grid column (ascending) and local z of each grid row (ascending, north to south); null when flat. */
  gridLines(): { xs: number[]; zs: number[] } | null;
}

/** The terrain with every height 0, for an area without elevation. */
export function flatTerrain(): Terrain {
  return {
    hasGround: false,
    baseline: 0,
    spacing: 0,
    heightAtLonLat: () => 0,
    heightAtLocal: () => 0,
    roadHeights: () => null,
    lowestUnder: () => 0,
    gridLines: () => null,
  };
}

/** The terrain of an area's elevation grid, in the world's projection. */
export function createTerrain(elevation: Elevation, projection: Projection): Terrain {
  const { origin, lat_step, lon_step, rows, cols, heights } = elevation.grid;
  const baseline = heights.length ? heights.reduce((low, h) => Math.min(low, h), Infinity) : 0;
  const at = (row: number, col: number) => heights[row * cols + col];

  const heightAtLonLat = ([lon, lat]: Position): number => {
    if (!heights.length || rows < 1 || cols < 1) return 0;
    const col = clamp((lon - origin.longitude) / lon_step, 0, cols - 1);
    const row = clamp((lat - origin.latitude) / lat_step, 0, rows - 1);
    const c0 = Math.min(Math.floor(col), Math.max(cols - 2, 0));
    const r0 = Math.min(Math.floor(row), Math.max(rows - 2, 0));
    const c1 = Math.min(c0 + 1, cols - 1);
    const r1 = Math.min(r0 + 1, rows - 1);
    const fc = col - c0;
    const fr = row - r0;
    const south = at(r0, c0) * (1 - fc) + at(r0, c1) * fc;
    const north = at(r1, c0) * (1 - fc) + at(r1, c1) * fc;
    return south * (1 - fr) + north * fr;
  };
  const heightAtLocal = (x: number, z: number) => heightAtLonLat(toLonLat(projection, x, z)) - baseline;

  // The grid is axis-aligned in the local frame (the projection is linear), so its lines are plain x and z values.
  const xs = Array.from({ length: cols }, (_, c) => (origin.longitude + c * lon_step - projection.origin.longitude) * projection.meters_per_degree_longitude);
  const zs = Array.from({ length: rows }, (_, r) => -(origin.latitude + (rows - 1 - r) * lat_step - projection.origin.latitude) * projection.meters_per_degree_latitude);
  const spacing = Math.min(Math.abs(lon_step) * projection.meters_per_degree_longitude, Math.abs(lat_step) * projection.meters_per_degree_latitude);

  return {
    hasGround: true,
    baseline,
    spacing,
    heightAtLonLat,
    heightAtLocal,
    roadHeights(feature, mode) {
      const values = mode === "exact" ? feature.properties.elevation_exact : feature.properties.elevation_smoothed;
      return values ? values.map((h) => h - baseline) : null;
    },
    lowestUnder(ring) {
      let low = Infinity;
      for (const p of ring) low = Math.min(low, heightAtLocal(p.x, p.z));
      const [minX, maxX, minZ, maxZ] = [Math.min(...ring.map((p) => p.x)), Math.max(...ring.map((p) => p.x)), Math.min(...ring.map((p) => p.z)), Math.max(...ring.map((p) => p.z))];
      for (const z of zs) {
        if (z < minZ || z > maxZ) continue;
        for (const x of xs) {
          if (x < minX || x > maxX) continue;
          if (insideRing(ring, x, z)) low = Math.min(low, heightAtLocal(x, z));
        }
      }
      return Number.isFinite(low) ? low : 0;
    },
    gridLines: () => ({ xs, zs }),
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Even-odd point-in-polygon test in the local plane. */
function insideRing(ring: Local[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** How long a triangle edge may be on a layer draped over the terrain, in meters: twice the grid's cell, at least 4. */
export function maxEdgeFor(terrain: Terrain): number {
  return terrain.hasGround ? Math.max(4, terrain.spacing * 2) : Infinity;
}

/** Inserts points along each edge of a ring so no edge is longer than `maxEdge`. A closed ring stays closed. */
export function subdivideRing(ring: Local[], maxEdge: number): Local[] {
  if (!(maxEdge > 0) || !Number.isFinite(maxEdge) || ring.length < 2) return ring;
  const out: Local[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [a, b] = [ring[i], ring[i + 1]];
    const parts = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / maxEdge));
    for (let k = 0; k < parts; k++) out.push({ x: a.x + ((b.x - a.x) * k) / parts, z: a.z + ((b.z - a.z) * k) / parts });
  }
  out.push(ring[ring.length - 1]);
  return out;
}

/**
 * Splits triangles until no edge is longer than `maxEdge` (measured on the ground plane). `positions`
 * is x, y, z triples and `indices` triangles into it. Every long edge is split at its midpoint, once
 * for both triangles that share it, so the mesh stays watertight. Returns new arrays.
 */
export function subdivideTriangles(positions: ArrayLike<number>, indices: ArrayLike<number>, maxEdge: number): { positions: number[]; indices: number[] } {
  const pos = Array.from(positions);
  let tris = Array.from(indices);
  if (!(maxEdge > 0) || !Number.isFinite(maxEdge)) return { positions: pos, indices: tris };
  const length = (a: number, b: number) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 2] - pos[b * 3 + 2]);
  for (let round = 0; round < 16; round++) {
    const mids = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      let index = mids.get(key);
      if (index === undefined) {
        index = pos.length / 3;
        pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
        mids.set(key, index);
      }
      return index;
    };
    // Decide every split from the edge lengths before any midpoint is added, so both sides of an edge agree.
    const long = (a: number, b: number) => length(a, b) > maxEdge;
    const next: number[] = [];
    let split = false;
    for (let t = 0; t < tris.length; t += 3) {
      const v = [tris[t], tris[t + 1], tris[t + 2]];
      const edges = [long(v[0], v[1]), long(v[1], v[2]), long(v[2], v[0])];
      const count = edges.filter(Boolean).length;
      if (count === 0) {
        next.push(...v);
        continue;
      }
      split = true;
      if (count === 3) {
        const [m0, m1, m2] = [mid(v[0], v[1]), mid(v[1], v[2]), mid(v[2], v[0])];
        next.push(v[0], m0, m2, m0, v[1], m1, m2, m1, v[2], m0, m1, m2);
      } else if (count === 1) {
        const k = edges.indexOf(true);
        const [a, b, c] = [v[k], v[(k + 1) % 3], v[(k + 2) % 3]];
        const m = mid(a, b);
        next.push(a, m, c, m, b, c);
      } else {
        const k = (edges.indexOf(false) + 1) % 3; // the two split edges are then edge k and edge k + 1
        const [a, b, c] = [v[k], v[(k + 1) % 3], v[(k + 2) % 3]];
        const [m0, m1] = [mid(a, b), mid(b, c)];
        next.push(m0, b, m1, a, m0, m1, a, m1, c);
      }
    }
    tris = next;
    if (!split) break;
  }
  return { positions: pos, indices: tris };
}

/** Sets each vertex's y (the middle of every x, y, z triple) to `height(x, z) + lift`. Returns `positions`. */
export function drape(positions: { [index: number]: number; length: number }, height: (x: number, z: number) => number, lift = 0) {
  for (let i = 0; i + 2 < positions.length; i += 3) positions[i + 1] = height(positions[i], positions[i + 2]) + lift;
  return positions;
}

/** A regular mesh of the ground over a local extent: one vertex on each grid line inside it, and on the extent's edges. */
export function groundMesh(terrain: Terrain, minX: number, maxX: number, minZ: number, maxZ: number): { positions: number[]; indices: number[] } {
  const lines = terrain.gridLines();
  const axis = (nodes: number[], low: number, high: number) => [low, ...nodes.filter((v) => v > low && v < high), high];
  const xs = axis(lines?.xs ?? [], minX, maxX);
  const zs = axis(lines?.zs ?? [], minZ, maxZ);
  const positions: number[] = [];
  for (const z of zs) for (const x of xs) positions.push(x, terrain.heightAtLocal(x, z), z);
  const indices: number[] = [];
  const at = (i: number, j: number) => j * xs.length + i;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const [a, b, c, d] = [at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1)]; // b is south of a, c east of a
      indices.push(a, b, c, c, b, d); // both face up
    }
  }
  return { positions, indices };
}

/** One segment's height along its centreline, for the road's outline to follow. */
export interface RoadSurface {
  /** Scene y at (x, z): the stored height interpolated at the nearest point on the centreline. */
  at(x: number, z: number): number;
}

/**
 * `lines` are the centreline parts in local meters and `heights` one array per part with a value per
 * vertex (or null to sample `fallback`, the terrain, instead). The height at a point is the heights at
 * the ends of the nearest segment, blended by where the point projects onto it.
 */
export function roadSurface(lines: Local[][], heights: number[][] | null, fallback: (x: number, z: number) => number): RoadSurface {
  return {
    at(x, z) {
      if (!heights) return fallback(x, z);
      let best = Infinity;
      let value = fallback(x, z);
      lines.forEach((line, l) => {
        const h = heights[l];
        if (!h || h.length < line.length) return;
        if (line.length === 1) {
          const d = Math.hypot(x - line[0].x, z - line[0].z);
          if (d < best) [best, value] = [d, h[0]];
        }
        for (let i = 0; i + 1 < line.length; i++) {
          const [a, b] = [line[i], line[i + 1]];
          const [dx, dz] = [b.x - a.x, b.z - a.z];
          const squared = dx * dx + dz * dz;
          const t = squared === 0 ? 0 : clamp(((x - a.x) * dx + (z - a.z) * dz) / squared, 0, 1);
          const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
          if (d < best) [best, value] = [d, h[i] * (1 - t) + h[i + 1] * t];
        }
      });
      return value;
    },
  };
}

/** Splits a feature's flat per-vertex array into one array per line part, by the parts' vertex counts. */
export function splitByLines(values: number[] | null, lines: Local[][]): number[][] | null {
  if (!values) return null;
  if (values.length !== lines.reduce((sum, line) => sum + line.length, 0)) return null;
  let offset = 0;
  return lines.map((line) => values.slice(offset, (offset += line.length)));
}
