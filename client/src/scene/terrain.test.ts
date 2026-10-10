import { describe, expect, it } from "vitest";
import type { Elevation, Feature, Projection, RoadSegmentProperties } from "../api/types";
import type { Local } from "./projection";
import { clipPolygonToRect, clipRingToRect, createTerrain, drape, flatTerrain, groundMesh, maxEdgeFor, roadSurface, splitByLines, subdivideRing, subdivideTriangles } from "./terrain";

// 1 degree = 100 m both ways, so local meters are easy to read: x = (lon - 10) * 100, z = -(lat - 20) * 100.
const projection: Projection = { origin: { latitude: 20, longitude: 10 }, meters_per_degree_latitude: 100, meters_per_degree_longitude: 100 };

/** A 3 x 4 grid (3 rows south to north, 4 columns west to east) whose height is `base + 10 * row + col`. */
function elevation(base = 100): Elevation {
  const rows = 3;
  const cols = 4;
  const heights = Array.from({ length: rows * cols }, (_, i) => base + 10 * Math.floor(i / cols) + (i % cols));
  return {
    source: "aws-terrain-tiles",
    attribution: "terrain",
    version: 1,
    smoothing_meters: 30,
    grid: { origin: { latitude: 20, longitude: 10 }, lat_step: 0.01, lon_step: 0.01, rows, cols, heights },
  };
}

const terrain = createTerrain(elevation(), projection);
const edge = (positions: number[], a: number, b: number) => Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 2] - positions[b * 3 + 2]);
/** Degrees times 100 leaves floating-point dust (1.0000000000000009), and -0 for the southern line. */
const clean = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

describe("createTerrain", () => {
  it("is exact at the grid points", () => {
    expect(terrain.heightAtLonLat([10, 20])).toBeCloseTo(100); // SW corner
    expect(terrain.heightAtLonLat([10.03, 20.02])).toBeCloseTo(123); // NE corner
    expect(terrain.heightAtLonLat([10.01, 20.01])).toBeCloseTo(111);
  });

  it("interpolates bilinearly between them", () => {
    expect(terrain.heightAtLonLat([10.005, 20])).toBeCloseTo(100.5);
    expect(terrain.heightAtLonLat([10, 20.005])).toBeCloseTo(105);
    expect(terrain.heightAtLonLat([10.005, 20.005])).toBeCloseTo(105.5);
  });

  it("clamps outside the grid to its edge", () => {
    expect(terrain.heightAtLonLat([9, 19])).toBeCloseTo(100);
    expect(terrain.heightAtLonLat([11, 21])).toBeCloseTo(123);
    expect(terrain.heightAtLonLat([10.015, 25])).toBeCloseTo(121.5); // north edge, between columns 1 and 2
  });

  it("puts the baseline at the grid's lowest point and offsets the scene's y by it", () => {
    expect(terrain.baseline).toBe(100);
    expect(terrain.heightAtLocal(0, 0)).toBeCloseTo(0); // local (0, 0) is the SW corner, the lowest point
    expect(terrain.heightAtLocal(3, -2)).toBeCloseTo(23); // the NE corner
  });

  it("maps local meters (x east, z south) to the grid", () => {
    // lon 10.01, lat 20.01 is local (1, -1): 111 above sea level, 11 above the baseline.
    expect(terrain.heightAtLocal(1, -1)).toBeCloseTo(11);
    // North is -z: lat 20.02 is local z = -2.
    expect(terrain.heightAtLocal(0, -2)).toBeCloseTo(20);
  });

  it("reads a segment's stored heights as scene y", () => {
    const feature = { properties: { elevation_exact: [105, 110], elevation_smoothed: null } } as unknown as Feature<RoadSegmentProperties>;
    expect(terrain.roadHeights(feature, "exact")).toEqual([5, 10]);
    expect(terrain.roadHeights(feature, "smoothed")).toBeNull();
  });

  it("finds the lowest ground under a footprint, grid points inside included", () => {
    const square: Local[] = [{ x: 0.5, z: -0.5 }, { x: 2, z: -0.5 }, { x: 2, z: -1.5 }, { x: 0.5, z: -1.5 }];
    // The lowest vertex is (0.5, -0.5): row 0.5, col 0.5 -> 105.5 above sea level; the grid points inside (1, -1) and (2, -1) are higher.
    expect(terrain.lowestUnder(square)).toBeCloseTo(5.5);
  });

  it("offers its grid lines in local meters", () => {
    const lines = terrain.gridLines()!;
    expect(lines.xs.map(clean)).toEqual([0, 1, 2, 3]);
    expect(lines.zs.map(clean)).toEqual([-2, -1, 0]);
  });
});

describe("flatTerrain", () => {
  it("answers 0 everywhere and has no ground", () => {
    const flat = flatTerrain();
    expect([flat.hasGround, flat.baseline, flat.heightAtLocal(5, 7), flat.heightAtLonLat([1, 2]), flat.lowestUnder([{ x: 0, z: 0 }]), flat.gridLines()]).toEqual([false, 0, 0, 0, 0, null]);
    expect(flat.roadHeights({ properties: { elevation_exact: [1] } } as unknown as Feature<RoadSegmentProperties>, "exact")).toBeNull();
    expect(maxEdgeFor(flat)).toBe(Infinity);
  });
});

describe("subdivideRing", () => {
  it("bounds every edge and keeps the corners and the closure", () => {
    const ring: Local[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 0, z: 0 }];
    const out = subdivideRing(ring, 3);
    for (let i = 0; i + 1 < out.length; i++) expect(Math.hypot(out[i + 1].x - out[i].x, out[i + 1].z - out[i].z)).toBeLessThanOrEqual(3 + 1e-9);
    expect(out[0]).toEqual(ring[0]);
    expect(out.at(-1)).toEqual(ring.at(-1));
    expect(out).toContainEqual({ x: 10, z: 0 });
  });
});

describe("subdivideTriangles", () => {
  const long = { positions: [0, 0, 0, 20, 0, 0, 0, 0, 20], indices: [0, 1, 2] };

  it("bounds every edge by maxEdge", () => {
    const { positions, indices } = subdivideTriangles(long.positions, long.indices, 4);
    for (let t = 0; t < indices.length; t += 3) {
      for (let k = 0; k < 3; k++) expect(edge(positions, indices[t + k], indices[t + ((k + 1) % 3)])).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it("keeps the area and the facing", () => {
    const { positions, indices } = subdivideTriangles(long.positions, long.indices, 4);
    let area = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => ({ x: positions[i * 3], z: positions[i * 3 + 2] }));
      area += ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2; // signed
    }
    const original = (20 * 20) / 2; // (0,0) -> (20,0) -> (0,20): positive in this convention
    expect(area).toBeCloseTo(original);
  });

  it("splits a shared edge once, so two triangles stay joined", () => {
    // Two triangles sharing the long diagonal; every vertex of the result used by both sides is the same index.
    const quad = { positions: [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10], indices: [0, 1, 2, 0, 2, 3] };
    const { positions, indices } = subdivideTriangles(quad.positions, quad.indices, 3);
    const used = new Set(indices);
    // No two distinct vertices share a position.
    const keys = new Set([...used].map((i) => `${positions[i * 3].toFixed(6)},${positions[i * 3 + 2].toFixed(6)}`));
    expect(keys.size).toBe(used.size);
  });

  it("leaves small triangles alone", () => {
    const small = { positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 1, 2] };
    expect(subdivideTriangles(small.positions, small.indices, 4)).toEqual(small);
  });
});

describe("drape", () => {
  it("puts every vertex of a subdivided, sloped surface on the terrain", () => {
    const { positions, indices } = subdivideTriangles([0, 0, -2, 3, 0, -2, 3, 0, 0, 0, 0, 0], [0, 1, 2, 0, 2, 3], 0.4);
    expect(positions.length / 3).toBeGreaterThan(20);
    drape(positions, terrain.heightAtLocal, 0.05);
    for (let i = 0; i < positions.length; i += 3) expect(positions[i + 1]).toBeCloseTo(terrain.heightAtLocal(positions[i], positions[i + 2]) + 0.05);
    // The slope shows: the north-east corner (3, -2) is 23 m above the baseline.
    expect(Math.max(...positions.filter((_, i) => i % 3 === 1))).toBeGreaterThan(20);
    expect(indices.length).toBeGreaterThan(6);
  });
});

describe("groundMesh", () => {
  it("covers the extent with a vertex on every grid line inside it and on every edge", () => {
    const { positions, indices } = groundMesh(terrain, -1, 4, -3, 1);
    const xs = new Set(positions.filter((_, i) => i % 3 === 0));
    const zs = new Set(positions.filter((_, i) => i % 3 === 2));
    expect([...xs].map(clean).sort((a, b) => a - b)).toEqual([-1, 0, 1, 2, 3, 4]);
    expect([...zs].map(clean).sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1]);
    expect(indices.length / 3).toBe(2 * 5 * 4);
  });

  it("sits on the terrain and faces up", () => {
    const { positions, indices } = groundMesh(terrain, 0, 3, -2, 0);
    for (let i = 0; i < positions.length; i += 3) expect(positions[i + 1]).toBe(terrain.heightAtLocal(positions[i], positions[i + 2]));
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => ({ x: positions[i * 3], z: positions[i * 3 + 2] }));
      expect((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)).toBeLessThan(0); // a triangle (a, b, c) faces +y when this 2D cross product in (x, z) is negative
    }
  });

  it("clips to a smaller extent than the grid", () => {
    const { positions } = groundMesh(terrain, 0.5, 1.5, -1.5, -0.5);
    expect([...new Set(positions.filter((_, i) => i % 3 === 0))].map(clean)).toEqual([0.5, 1, 1.5]);
  });
});

describe("roadSurface", () => {
  const line: Local[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  const fallback = () => -1;

  it("interpolates the stored heights along the nearest segment", () => {
    const surface = roadSurface([line], [[0, 10, 30]], fallback);
    expect(surface.at(5, 3)).toBeCloseTo(5); // beside the first segment's middle
    expect(surface.at(10, 5)).toBeCloseTo(20); // beside the second's middle
    expect(surface.at(-4, 0)).toBeCloseTo(0); // beyond the start: clamped to its end
  });

  it("takes the part that is nearest when a segment has several", () => {
    const surface = roadSurface([[{ x: 0, z: 0 }, { x: 10, z: 0 }], [{ x: 0, z: 50 }, { x: 10, z: 50 }]], [[1, 1], [9, 9]], fallback);
    expect(surface.at(5, 4)).toBe(1);
    expect(surface.at(5, 45)).toBe(9);
  });

  it("samples the fallback when there are no heights", () => {
    expect(roadSurface([line], null, fallback).at(1, 1)).toBe(-1);
  });
});

describe("splitByLines", () => {
  const lines: Local[][] = [[{ x: 0, z: 0 }, { x: 1, z: 0 }], [{ x: 5, z: 5 }, { x: 6, z: 5 }, { x: 7, z: 5 }]];
  it("cuts the flat array by each part's vertex count", () => {
    expect(splitByLines([1, 2, 3, 4, 5], lines)).toEqual([[1, 2], [3, 4, 5]]);
  });
  it("gives null for a missing array or a length that doesn't match", () => {
    expect(splitByLines(null, lines)).toBeNull();
    expect(splitByLines([1, 2, 3], lines)).toBeNull();
  });
});

describe("terrain extent", () => {
  it("is the grid in local metres, and null when flat", () => {
    expect(terrain.extent()).toEqual({ minX: 0, maxX: 3, minZ: -2, maxZ: 0 });
    expect(flatTerrain().extent()).toBeNull();
  });
});

describe("clipRingToRect", () => {
  const rect = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
  const box = (x0: number, z0: number, x1: number, z1: number): Local[] => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }, { x: x0, z: z0 }];
  const area = (ring: Local[]) => Math.abs(ring.slice(0, -1).reduce((sum, p, i) => sum + p.x * ring[i + 1].z - ring[i + 1].x * p.z, 0)) / 2;

  it("keeps a ring that is inside, unchanged", () => {
    expect(clipRingToRect(box(2, 2, 5, 5), rect)).toEqual(box(2, 2, 5, 5));
  });

  it("drops a ring that is outside", () => {
    expect(clipRingToRect(box(20, 20, 30, 30), rect)).toEqual([]);
  });

  it("cuts a crossing ring at the rectangle's edges and stays closed", () => {
    const clipped = clipRingToRect(box(5, 5, 50, 50), rect);
    expect(clipped[0]).toEqual(clipped[clipped.length - 1]);
    expect(area(clipped)).toBeCloseTo(25);
    for (const p of clipped) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(10);
      expect(p.z).toBeLessThanOrEqual(10);
    }
  });

  it("reduces a ring that covers the rectangle to the rectangle", () => {
    expect(area(clipRingToRect(box(-100, -100, 100, 100), rect))).toBeCloseTo(100);
  });

  it("clips a polygon's holes, drops the ones outside, and drops a polygon whose outer ring vanishes", () => {
    const outer = box(-5, -5, 20, 20);
    const inside = box(2, 2, 4, 4);
    const crossing = box(8, 8, 15, 15);
    const far = box(40, 40, 45, 45);
    const clipped = clipPolygonToRect([outer, inside, crossing, far], rect)!;
    expect(clipped).toHaveLength(3);
    expect(area(clipped[2])).toBeCloseTo(4);
    expect(clipPolygonToRect([box(20, 20, 30, 30), inside], rect)).toBeNull();
  });
});
