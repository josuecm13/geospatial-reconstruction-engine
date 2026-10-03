import { describe, expect, it } from "vitest";
import type { BoundingBox, Position } from "../api/types";
import { closeRing, ringProblem, simplifyFreehand } from "./boundaryGeometry";

const BBOX: BoundingBox = { min_latitude: 0, min_longitude: 0, max_latitude: 1, max_longitude: 1 };
const SQUARE: Position[] = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]];

describe("closeRing", () => {
  it("appends the first point when the ring is open", () => {
    expect(closeRing([[0, 0], [1, 0], [1, 1]])).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
  });
  it("leaves a closed ring alone", () => {
    expect(closeRing(SQUARE)).toEqual(SQUARE);
  });
  it("returns an empty ring for no points", () => {
    expect(closeRing([])).toEqual([]);
  });
});

describe("simplifyFreehand", () => {
  it("removes collinear points and keeps the corners of a square", () => {
    const step = 0.00001;
    const side = 100 * step;
    const path: Position[] = [];
    for (let i = 0; i <= 100; i++) path.push([i * step, 0]);
    for (let i = 1; i <= 100; i++) path.push([side, i * step]);
    for (let i = 1; i <= 100; i++) path.push([side - i * step, side]);
    for (let i = 1; i <= 100; i++) path.push([0, side - i * step]);
    const simplified = simplifyFreehand(path, 1, 0);
    expect(simplified).toHaveLength(5);
    expect(simplified[0]).toEqual([0, 0]);
    expect(simplified[1]).toEqual([side, 0]);
    expect(simplified[2]).toEqual([side, side]);
    expect(simplified[3][0]).toBeCloseTo(0, 12);
    expect(simplified[3][1]).toBeCloseTo(side, 12);
    expect(simplified[4]).toEqual(path[path.length - 1]);
  });
  it("keeps a point that sticks out further than the tolerance, and drops one within it", () => {
    const bump = 0.00002; // about 2.2 m at the equator
    const path: Position[] = [[0, 0], [0.0001, bump], [0.0002, 0]];
    expect(simplifyFreehand(path, 1, 0)).toHaveLength(3);
    expect(simplifyFreehand(path, 5, 0)).toHaveLength(2);
  });
  it("returns short paths unchanged", () => {
    expect(simplifyFreehand([[0, 0], [1, 1]], 1, 0)).toEqual([[0, 0], [1, 1]]);
  });
});

describe("ringProblem", () => {
  it("accepts a simple shape inside the box, closed or not", () => {
    expect(ringProblem(SQUARE, BBOX)).toBeNull();
    expect(ringProblem(SQUARE.slice(0, -1), BBOX)).toBeNull();
  });
  it("flags fewer than three distinct corners", () => {
    expect(ringProblem([[0.2, 0.2], [0.8, 0.8], [0.2, 0.2]], BBOX)).toBe("too_few_vertices");
    expect(ringProblem([], BBOX)).toBe("too_few_vertices");
  });
  it("flags a bow-tie as self-intersecting", () => {
    expect(ringProblem([[0.2, 0.2], [0.8, 0.8], [0.8, 0.2], [0.2, 0.8], [0.2, 0.2]], BBOX)).toBe("self_intersecting");
  });
  it("flags a corner that folds back along its own edge", () => {
    expect(ringProblem([[0.2, 0.2], [0.8, 0.2], [0.5, 0.2], [0.5, 0.8], [0.2, 0.2]], BBOX)).toBe("self_intersecting");
  });
  it("flags a vertex outside the import area", () => {
    expect(ringProblem([[0.2, 0.2], [1.5, 0.2], [0.8, 0.8], [0.2, 0.2]], BBOX)).toBe("outside_import_area");
  });
});
