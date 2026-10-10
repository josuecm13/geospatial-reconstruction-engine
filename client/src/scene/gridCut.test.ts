import { describe, expect, it } from "vitest";
import type { Elevation, Projection } from "../api/types";
import { drapedGeometry } from "./extrude";
import { gridCutTriangles } from "./gridCut";
import type { Local } from "./projection";
import { createTerrain } from "./terrain";

// A 5 x 5 cell grid of 10 m cells: x from 0 to 50, z from -50 to 0.
const lines = { xs: [0, 10, 20, 30, 40, 50], zs: [-50, -40, -30, -20, -10, 0] };

const rect = (x0: number, z0: number, x1: number, z1: number): Local[] => [
  { x: x0, z: z0 },
  { x: x1, z: z0 },
  { x: x1, z: z1 },
  { x: x0, z: z1 },
];
const shoelace = (ring: Local[]) => ring.reduce((sum, a, i) => sum + (a.x * ring[(i + 1) % ring.length].z - ring[(i + 1) % ring.length].x * a.z) / 2, 0);

/** Total area, and whether every triangle faces up (negative 2D cross product in (x, z), as in `groundMesh`). */
function measure(flat: number[]) {
  let area = 0;
  let up = true;
  for (let i = 0; i < flat.length; i += 6) {
    const cross = (flat[i + 2] - flat[i]) * (flat[i + 5] - flat[i + 1]) - (flat[i + 3] - flat[i + 1]) * (flat[i + 4] - flat[i]);
    if (cross >= 0) up = false;
    area += Math.abs(cross) / 2;
  }
  return { triangles: flat.length / 6, area, up };
}

// A C-shaped polygon (concave), with a hole that crosses grid lines and one inside a cell.
const c: Local[] = [
  { x: 3, z: -47 }, { x: 47, z: -47 }, { x: 47, z: -3 }, { x: 25, z: -3 }, { x: 25, z: -20 },
  { x: 33, z: -20 }, { x: 33, z: -30 }, { x: 15, z: -30 }, { x: 15, z: -3 }, { x: 3, z: -3 },
];
const crossingHole = rect(8.5, -44, 14.2, -33).reverse();
const smallHole = rect(36, -26, 38, -24);

describe("gridCutTriangles", () => {
  it("keeps the area of a concave polygon with holes, facing up", () => {
    const expected = shoelace(c) - Math.abs(shoelace(crossingHole)) - Math.abs(shoelace(smallHole));
    const { area, up } = measure(gridCutTriangles([[c, crossingHole, smallHole]], lines));
    expect(Math.abs(area - expected) / expected).toBeLessThan(1e-6);
    expect(up).toBe(true);
  });

  it("keeps the area of a hole that straddles grid lines, and of a polygon past the grid", () => {
    expect(measure(gridCutTriangles([[rect(5, -45, 45, -5), rect(18, -38, 32, -22)]], lines)).area).toBeCloseTo(40 * 40 - 14 * 16, 6);
    expect(measure(gridCutTriangles([[rect(-20, -70, 70, 20)]], lines)).area).toBeCloseTo(90 * 90, 6);
  });

  it("handles outlines along grid lines and through grid nodes", () => {
    expect(measure(gridCutTriangles([[rect(10, -40, 30, -20)]], lines)).area).toBeCloseTo(400, 9);
    const diamond: Local[] = [{ x: 20, z: -40 }, { x: 40, z: -20 }, { x: 20, z: 0 }, { x: 0, z: -20 }];
    expect(measure(gridCutTriangles([[diamond]], lines)).area).toBeCloseTo(800, 9);
  });

  it("does not depend on the ring's winding or its closing point", () => {
    const closed = [...c, c[0]].reverse();
    expect(measure(gridCutTriangles([[closed]], lines)).area).toBeCloseTo(shoelace(c), 6);
  });

  it("cuts a cell wholly inside the polygon into exactly two triangles, on groundMesh's diagonal", () => {
    // The cell x 20..30, z -30..-20 lies well inside a 40 x 40 square.
    const flat = gridCutTriangles([[rect(5, -45, 45, -5)]], lines);
    const inCell = [];
    for (let i = 0; i < flat.length; i += 6) {
      const xs = [flat[i], flat[i + 2], flat[i + 4]];
      const zs = [flat[i + 1], flat[i + 3], flat[i + 5]];
      if (xs.every((x) => x >= 20 && x <= 30) && zs.every((z) => z >= -30 && z <= -20)) inCell.push(i);
    }
    expect(inCell).toHaveLength(2);
    // (x0, z0) (x0, z1) (x1, z0) and (x1, z0) (x0, z1) (x1, z1): the diagonal runs from (20, -20) to (30, -30).
    expect(flat.slice(inCell[0], inCell[0] + 6)).toEqual([20, -30, 20, -20, 30, -30]);
    expect(flat.slice(inCell[1], inCell[1] + 6)).toEqual([30, -30, 20, -20, 30, -20]);
  });

  it("is watertight: the vertices on a cut line are the same on both sides, at the very same coordinates", () => {
    const flat = gridCutTriangles([[c]], lines);
    for (const line of [10, 20, 30, 40]) {
      const left = new Set<number>();
      const right = new Set<number>();
      for (let i = 0; i < flat.length; i += 6) {
        const xs = [flat[i], flat[i + 2], flat[i + 4]];
        const side = xs.every((x) => x <= line) ? left : xs.every((x) => x >= line) ? right : null;
        expect(side).not.toBeNull(); // every triangle lies in one cell
        xs.forEach((x, k) => x === line && side!.add(flat[i + k * 2 + 1]));
      }
      expect([...left].sort()).toEqual([...right].sort());
      // Where the outline itself crosses the line, both sides hold the one computed point.
      const crossings = c.flatMap((a, i) => {
        const b = c[(i + 1) % c.length];
        return (a.x < line && line < b.x) || (b.x < line && line < a.x) ? [a.z + ((b.z - a.z) * (line - a.x)) / (b.x - a.x)] : [];
      });
      for (const z of crossings) {
        expect(left.has(z)).toBe(true);
        expect(right.has(z)).toBe(true);
      }
    }
  });

  it("bounds the triangle count by the cells overlapped and the ring's vertices", () => {
    // A thin sliver, 2000 x 3 m on a 10 m grid, and a 1000-vertex wavy ring.
    const sliver = (length: number) => {
      const grid = { xs: Array.from({ length: Math.ceil(length / 10) + 5 }, (_, i) => i * 10), zs: [-10, 0, 10] };
      const ring: Local[] = [{ x: 1, z: 1 }, { x: length + 1.3, z: 2.1 }, { x: length + 1.3, z: 4.4 }, { x: 1, z: 3.3 }];
      return { triangles: measure(gridCutTriangles([[ring]], grid)).triangles, cells: Math.ceil(length / 10) + 1, vertices: ring.length };
    };
    const wavy: Local[] = Array.from({ length: 1000 }, (_, i) => {
      const a = (i / 1000) * 2 * Math.PI;
      const r = 20 + 3 * Math.sin(a * 40);
      return { x: 25 + r * Math.cos(a), z: -25 + r * Math.sin(a) };
    });
    // Each interior cell is 2 triangles; a cell the outline passes through is a piece with at most 4 corners plus the
    // outline's vertices in it, so at most 4 + (its vertices) triangles. Summed: at most 4 per cell + 1 per ring vertex
    // (+ 1 per cut vertex, at most one per cell). c = 2 covers the ring's vertices and its cuts with room to spare.
    const bound = (cells: number, vertices: number) => 4 * cells + 2 * vertices;
    const s = sliver(2000);
    expect(s.triangles).toBeLessThanOrEqual(bound(s.cells, s.vertices));
    const w = measure(gridCutTriangles([[wavy]], lines));
    expect(w.triangles).toBeLessThanOrEqual(bound(36, wavy.length)); // the wavy ring's box overlaps at most 6 x 6 cells
    expect(w.area).toBeCloseTo(Math.abs(shoelace(wavy)), 6);
    // Growth is linear in the length (it was quadratic): doubling a sliver doubles its triangles, not quadruples them.
    expect(sliver(4000).triangles / sliver(2000).triangles).toBeLessThan(2.2);
  });
});

describe("drapedGeometry", () => {
  const projection: Projection = { origin: { latitude: 20, longitude: 10 }, meters_per_degree_latitude: 100, meters_per_degree_longitude: 100 };
  const elevation: Elevation = {
    source: "aws-terrain-tiles",
    attribution: "terrain",
    version: 1,
    smoothing_meters: 30,
    grid: { origin: { latitude: 20, longitude: 10 }, lat_step: 0.1, lon_step: 0.1, rows: 5, cols: 5, heights: Array.from({ length: 25 }, (_, i) => 100 + 7 * Math.floor(i / 5) + 3 * (i % 5) + ((i * 7) % 5)) },
  };
  const terrain = createTerrain(elevation, projection);

  it("puts every vertex on the terrain, with holes and a polygon larger than the grid", () => {
    const grid = terrain.gridLines()!;
    const polygons = [[rect(1.3, -38.4, 33.3, -3.1), rect(12, -20, 17, -15).reverse()], [rect(-30, -60, 70, 30)]];
    const geometry = drapedGeometry(polygons, terrain.heightAtLocal, grid);
    const p = geometry.getAttribute("position");
    expect(p.count).toBeGreaterThan(0);
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(terrain.heightAtLocal(p.getX(i), p.getZ(i)), 3);
  });
});
