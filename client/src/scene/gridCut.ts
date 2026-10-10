import * as THREE from "three";
import type { Local } from "./projection";
import { clipRingToRect, type Rect } from "./terrain";

/**
 * Grid-cut triangulation: a polygon draped on the terrain is cut along the terrain grid's own lines, and
 * each piece is triangulated on its own.
 *
 * The terrain is bilinear inside a grid cell, so along a grid line it is linear between grid nodes. A
 * vertex put on a cut line therefore lies exactly on its neighbour's straight edge: no cracks, no T-junction
 * gaps. That is why the cuts are made at every grid line and never at coarser ones. Triangle count follows
 * the polygon's area (one piece per cell it overlaps) and its outline, not its length: a thin 1 km sliver
 * costs about two triangles per cell it crosses, where splitting its edges until none is long grows with the
 * square of the length.
 *
 * Cells beyond the outermost grid lines are unbounded: the terrain only clamps there, so it is linear along
 * one axis (or constant), and any triangulation of a piece in them is exact.
 *
 * How a cell's piece is found, with no polygon clipping against empty cells:
 *   1. Every ring edge is cut at the grid lines it crosses, once, in ring order. The cut point's coordinate
 *      on the line is the line's own value, so the two cells that share the cut see the very same point.
 *      After this no edge crosses a line, so each edge belongs to the one cell holding its midpoint (an edge
 *      lying along a line belongs to no cell: it is the boundary of the cell on its inside).
 *   2. Edges are bucketed by that cell (and by row, for the inside test), so a cell only looks at its own edges.
 *   3. A cell with edges: its edges form chains running from one point on the cell's boundary to another (or
 *      closed rings lying inside). Walking the boundary counter-clockwise from each chain's end to the next
 *      chain's start closes them into simple loops (outer loops and holes).
 *   4. A cell without edges is wholly inside or wholly outside: an even-odd count along the row's middle line.
 *      Inside, it is two triangles with the diagonal `groundMesh` uses.
 */

/** Local x of each grid column and z of each grid row; see `Terrain.gridLines`. */
export interface GridLines {
  xs: number[];
  zs: number[];
}

/** A triangle thinner than this (twice its area, in m^2) adds nothing and is dropped. */
const MIN_AREA = 1e-9;

/** Number of elements of the ascending `values` that are < `v`. */
function below(values: number[], v: number): number {
  let [lo, hi] = [0, values.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Number of elements of the ascending `values` that are <= `v`. */
function atMost(values: number[], v: number): number {
  let [lo, hi] = [0, values.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const ascending = (values: number[]) => (values.every((v, i) => i === 0 || values[i - 1] <= v) ? values : [...values].sort((a, b) => a - b));

const signedArea = (ring: Local[]) => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
};

/** The ring without its closing point and without consecutive repeats. */
function distinctRing(ring: Local[]): Local[] {
  const out: Local[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.z !== p.z) out.push(p);
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].z === out[out.length - 1].z) out.pop();
  return out;
}

interface Cut {
  t: number;
  x: number;
  z: number;
  /** Which coordinates are a grid line's own value. */
  onX: boolean;
  onZ: boolean;
}

/**
 * The ring with a vertex added wherever an edge crosses a grid line. Each crossing is computed once, from
 * the edge in ring order, and its coordinate on the line is the line's value exactly, so both cells that
 * border the cut get the identical point. Crossings of an x line and a z line at the same parameter (a grid
 * node) become one vertex, exactly on both lines.
 */
function densify(ring: Local[], xs: number[], zs: number[]): Local[] {
  const out: Local[] = [];
  for (let k = 0; k < ring.length; k++) {
    const [a, b] = [ring[k], ring[(k + 1) % ring.length]];
    out.push(a);
    const cuts: Cut[] = [];
    if (a.x !== b.x) {
      const [lo, hi] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
      for (let i = atMost(xs, lo); i < xs.length && xs[i] < hi; i++) {
        const t = (xs[i] - a.x) / (b.x - a.x);
        cuts.push({ t, x: xs[i], z: a.z + (b.z - a.z) * t, onX: true, onZ: false });
      }
    }
    if (a.z !== b.z) {
      const [lo, hi] = a.z < b.z ? [a.z, b.z] : [b.z, a.z];
      for (let i = atMost(zs, lo); i < zs.length && zs[i] < hi; i++) {
        const t = (zs[i] - a.z) / (b.z - a.z);
        cuts.push({ t, x: a.x + (b.x - a.x) * t, z: zs[i], onX: false, onZ: true });
      }
    }
    cuts.sort((p, q) => p.t - q.t);
    for (let i = 0; i < cuts.length; i++) {
      let cut = cuts[i];
      if (i + 1 < cuts.length && cuts[i + 1].t === cut.t) {
        const other = cuts[++i];
        cut = { t: cut.t, x: cut.onX ? cut.x : other.x, z: cut.onZ ? cut.z : other.z, onX: true, onZ: true };
      }
      out.push({ x: cut.x, z: cut.z });
    }
  }
  return distinctRing(out);
}

/** Even-odd point-in-polygon. */
function insideLoop(loop: Local[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [a, b] = [loop[i], loop[j]];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Appends a piece's triangles (outer loop and holes inside it) as x, z pairs, facing up, dropping slivers. */
function emitPiece(outer: Local[], holes: Local[][], out: number[]): void {
  const contour = outer.map((p) => new THREE.Vector2(p.x, p.z));
  const holeContours = holes.map((hole) => hole.map((p) => new THREE.Vector2(p.x, p.z)));
  const faces = THREE.ShapeUtils.triangulateShape(contour, holeContours); // may drop a repeated closing point, so read the vertices after
  const vertices = [...contour, ...holeContours.flat()];
  for (const face of faces) {
    const [a, b, c] = face.map((i) => vertices[i]);
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < MIN_AREA) continue;
    // A triangle faces up (+y) when (b - a) x (c - a) in the (x, z) plane is negative, as in `groundMesh`.
    if (cross < 0) out.push(a.x, a.y, b.x, b.y, c.x, c.y);
    else out.push(a.x, a.y, c.x, c.y, b.x, b.y);
  }
}

/** Two triangles for a cell wholly inside the polygon, split on the diagonal `groundMesh` uses, so the overlay and the ground agree. */
function emitCell(x0: number, x1: number, z0: number, z1: number, out: number[]): void {
  // groundMesh: a = (x0, z0), b = (x0, z1), c = (x1, z0), d = (x1, z1); triangles (a, b, c) and (c, b, d).
  out.push(x0, z0, x0, z1, x1, z0, x1, z0, x0, z1, x1, z1);
}

interface Chain {
  points: Local[];
  entry: number;
  exit: number;
}

/**
 * A polygon (outer ring first, then holes) as triangles: x, z for each of three vertices per triangle.
 * Every cell the polygon overlaps is triangulated on its own; see the file comment.
 */
function cutPolygon(rings: Local[][], xs: number[], zs: number[], out: number[]): void {
  const prepared = rings.map((ring, r) => {
    const dense = densify(distinctRing(ring), xs, zs);
    if (dense.length < 3 || Math.abs(signedArea(dense)) < MIN_AREA) return null;
    // Interior on the left: counter-clockwise (positive area) for the outer ring, clockwise for holes.
    return (signedArea(dense) > 0) === (r === 0) ? dense : dense.reverse();
  });
  if (!prepared[0]) return;
  const loops = prepared.filter((ring): ring is Local[] => ring !== null);

  // Vertices of every ring in one array; an edge is named by its start vertex.
  const points: Local[] = [];
  const next: number[] = [];
  const previous: number[] = [];
  for (const ring of loops) {
    const start = points.length;
    ring.forEach((p, i) => {
      points.push(p);
      next.push(start + ((i + 1) % ring.length));
      previous.push(start + ((i + ring.length - 1) % ring.length));
    });
  }

  const outer = loops[0];
  const [minX, maxX, minZ, maxZ] = [Math.min(...outer.map((p) => p.x)), Math.max(...outer.map((p) => p.x)), Math.min(...outer.map((p) => p.z)), Math.max(...outer.map((p) => p.z))];
  const [nx, ny] = [xs.length, zs.length];
  const onLine = (values: number[], v: number) => {
    const i = below(values, v);
    return i < values.length && values[i] === v;
  };

  // Bucket the edges: by cell, and by row (for the inside test of cells the outline never enters).
  const cells = new Map<number, number[]>();
  const rowEdges: number[][] = Array.from({ length: ny + 1 }, () => []);
  for (let e = 0; e < points.length; e++) {
    const [a, b] = [points[e], points[next[e]]];
    const [mx, mz] = [(a.x + b.x) / 2, (a.z + b.z) / 2];
    if (onLine(zs, mz)) continue; // along a z line: crosses no row middle and belongs to no cell
    const row = below(zs, mz);
    rowEdges[row].push(e);
    if (onLine(xs, mx)) continue; // along an x line: counts for the inside test only
    const key = row * (nx + 1) + below(xs, mx);
    const list = cells.get(key);
    if (list) list.push(e);
    else cells.set(key, [e]);
  }

  const bounds = (i: number, j: number): Rect => ({
    minX: i === 0 ? minX - 1 : xs[i - 1],
    maxX: i === nx ? maxX + 1 : xs[i],
    minZ: j === 0 ? minZ - 1 : zs[j - 1],
    maxZ: j === ny ? maxZ + 1 : zs[j],
  });

  /** Sutherland-Hodgman, used only when a cell's boundary walk is inconsistent (rounding at a node, a self-crossing outline). */
  const fallback = (i: number, j: number) => {
    const rect: Rect = { minX: i === 0 ? -Infinity : xs[i - 1], maxX: i === nx ? Infinity : xs[i], minZ: j === 0 ? -Infinity : zs[j - 1], maxZ: j === ny ? Infinity : zs[j] };
    const piece = clipRingToRect(loops[0], rect);
    if (piece.length < 3) return;
    const holes = loops.slice(1).filter((ring) => ring.every((p) => p.x > rect.minX && p.x < rect.maxX && p.z > rect.minZ && p.z < rect.maxZ));
    emitPiece(distinctRing(piece), holes, out);
  };

  const stamp = new Int32Array(points.length);
  const done = new Int32Array(points.length);
  let current = 0;

  const cutCell = (i: number, j: number, edges: number[]) => {
    const rect = bounds(i, j);
    const [width, height] = [rect.maxX - rect.minX, rect.maxZ - rect.minZ];
    const perimeter = 2 * (width + height);
    /** Distance counter-clockwise (x right, z up) from the cell's (minX, minZ) corner to the nearest boundary point. */
    const along = (p: Local) => {
      const [dBottom, dRight, dTop, dLeft] = [Math.abs(p.z - rect.minZ), Math.abs(p.x - rect.maxX), Math.abs(p.z - rect.maxZ), Math.abs(p.x - rect.minX)];
      const near = Math.min(dBottom, dRight, dTop, dLeft);
      const cx = Math.min(Math.max(p.x, rect.minX), rect.maxX);
      const cz = Math.min(Math.max(p.z, rect.minZ), rect.maxZ);
      const s = near === dBottom ? cx - rect.minX : near === dRight ? width + (cz - rect.minZ) : near === dTop ? width + height + (rect.maxX - cx) : 2 * width + height + (rect.maxZ - cz);
      return s >= perimeter ? s - perimeter : s;
    };

    current++;
    for (const e of edges) stamp[e] = current;
    const chains: Chain[] = [];
    for (const e of edges) {
      if (stamp[previous[e]] === current) continue; // not the start of a chain
      const chainPoints = [points[e]];
      let edge = e;
      for (;;) {
        done[edge] = current;
        chainPoints.push(points[next[edge]]);
        const following = next[edge];
        if (stamp[following] === current && done[following] !== current) edge = following;
        else break;
      }
      chains.push({ points: chainPoints, entry: along(chainPoints[0]), exit: along(chainPoints[chainPoints.length - 1]) });
    }
    // Rings lying wholly inside the cell.
    const closed: Local[][] = [];
    for (const e of edges) {
      if (done[e] === current) continue;
      const ring: Local[] = [];
      let edge = e;
      while (done[edge] !== current) {
        done[edge] = current;
        ring.push(points[edge]);
        edge = next[edge];
      }
      closed.push(ring);
    }

    const outers: Local[][] = [];
    const holes: Local[][] = [];
    if (chains.length) {
      // Close the chains into loops: from each chain's end, counter-clockwise along the boundary to the next chain's start.
      const items = chains.flatMap((chain, index) => [
        { s: chain.entry, exit: false, index },
        { s: chain.exit, exit: true, index },
      ]);
      items.sort((p, q) => p.s - q.s || (p.exit === q.exit ? 0 : p.exit ? -1 : 1)); // at the same point, an end comes before a start
      if (items.some((item, k) => item.exit === items[(k + 1) % items.length].exit)) return fallback(i, j);
      const successor = new Array<number>(chains.length);
      items.forEach((item, k) => {
        if (item.exit) successor[item.index] = items[(k + 1) % items.length].index;
      });
      const corners: { s: number; p: Local }[] = [
        { s: 0, p: { x: rect.minX, z: rect.minZ } },
        { s: width, p: { x: rect.maxX, z: rect.minZ } },
        { s: width + height, p: { x: rect.maxX, z: rect.maxZ } },
        { s: 2 * width + height, p: { x: rect.minX, z: rect.maxZ } },
      ];
      const seen = new Set<number>();
      for (let start = 0; start < chains.length; start++) {
        if (seen.has(start)) continue;
        const loop: Local[] = [];
        for (let c = start; !seen.has(c); c = successor[c]) {
          seen.add(c);
          loop.push(...chains[c].points);
          const [from, to] = [chains[c].exit, chains[successor[c]].entry];
          const wraps = to < from;
          corners
            .filter(({ s }) => (from < to ? s > from && s < to : wraps && (s > from || s < to)))
            .sort((p, q) => ((p.s - from + perimeter) % perimeter) - ((q.s - from + perimeter) % perimeter))
            .forEach(({ p }) => loop.push(p));
        }
        const ring = distinctRing(loop);
        const area = signedArea(ring);
        if (area < -MIN_AREA) return fallback(i, j); // a boundary loop always has its inside on the left
        if (area > MIN_AREA) outers.push(ring);
      }
    }
    for (const ring of closed) {
      const clean = distinctRing(ring);
      const area = signedArea(clean);
      if (area > MIN_AREA) outers.push(clean);
      else if (area < -MIN_AREA) holes.push(clean);
    }

    // Each hole goes with the smallest outer loop that contains it.
    const areas = outers.map((ring) => signedArea(ring));
    const owned: Local[][][] = outers.map(() => []);
    const orphans: Local[][] = [];
    for (const hole of holes) {
      let best = -1;
      outers.forEach((ring, k) => {
        if (insideLoop(ring, hole[0].x, hole[0].z) && (best < 0 || areas[k] < areas[best])) best = k;
      });
      if (best >= 0) owned[best].push(hole);
      else orphans.push(hole);
    }
    if (orphans.length) {
      // Holes in a cell the outline never leaves: the cell itself is the outer loop.
      if (chains.length || outers.length) return fallback(i, j);
      outers.push([
        { x: rect.minX, z: rect.minZ },
        { x: rect.maxX, z: rect.minZ },
        { x: rect.maxX, z: rect.maxZ },
        { x: rect.minX, z: rect.maxZ },
      ]);
      owned.push(orphans);
    }
    outers.forEach((ring, k) => emitPiece(ring, owned[k], out));
  };

  for (const [key, edges] of cells) cutCell(key % (nx + 1), Math.floor(key / (nx + 1)), edges);

  // Cells the outline never enters: wholly inside or outside. Only bounded cells can be inside.
  const [i0, i1] = [atMost(xs, minX), below(xs, maxX)];
  const [j0, j1] = [atMost(zs, minZ), below(zs, maxZ)];
  for (let j = Math.max(j0, 1); j <= Math.min(j1, ny - 1); j++) {
    if (!rowEdges[j].length) continue;
    const middle = (zs[j - 1] + zs[j]) / 2;
    const crossings: number[] = [];
    for (const e of rowEdges[j]) {
      const [a, b] = [points[e], points[next[e]]];
      if (a.z > middle !== b.z > middle) crossings.push(a.x + ((b.x - a.x) * (middle - a.z)) / (b.z - a.z));
    }
    crossings.sort((p, q) => p - q);
    for (let i = Math.max(i0, 1); i <= Math.min(i1, nx - 1); i++) {
      if (cells.has(j * (nx + 1) + i)) continue;
      if (below(crossings, (xs[i - 1] + xs[i]) / 2) % 2 === 1) emitCell(xs[i - 1], xs[i], zs[j - 1], zs[j], out);
    }
  }
}

/**
 * Triangles for flat polygons (each: outer ring first, then holes, in local metres) cut along `lines`:
 * a flat array of x, z for each of three vertices per triangle, every triangle facing up and inside one
 * grid cell. Heights are the caller's: a vertex on a cut line lies on the terrain's straight edge there.
 */
export function gridCutTriangles(polygons: Local[][][], lines: GridLines): number[] {
  const [xs, zs] = [ascending(lines.xs), ascending(lines.zs)];
  const out: number[] = [];
  for (const rings of polygons) if (rings.length) cutPolygon(rings, xs, zs, out);
  return out;
}
