import { describe, expect, it } from "vitest";
import type { BoundingBox, Position } from "../api/types";
import { closeRing, douglasPeucker, ringProblem } from "./boundaryGeometry";

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

describe("douglasPeucker", () => {
  it("removes collinear points and keeps the corners of a square", () => {
    const path: [number, number][] = [];
    for (let i = 0; i <= 100; i++) path.push([i, 0]);
    for (let i = 1; i <= 100; i++) path.push([100, i]);
    for (let i = 1; i <= 100; i++) path.push([100 - i, 100]);
    for (let i = 1; i <= 100; i++) path.push([0, 100 - i]);
    const keep = douglasPeucker(path, 1);
    expect(path.filter((_, i) => keep[i])).toEqual([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]);
  });
  it("keeps a point that sticks out further than the tolerance, and drops one within it", () => {
    const path: [number, number][] = [[0, 0], [10, 2], [20, 0]];
    expect(douglasPeucker(path, 1)).toEqual([true, true, true]);
    expect(douglasPeucker(path, 5)).toEqual([true, false, true]);
  });
  it("keeps short paths whole", () => {
    expect(douglasPeucker([[0, 0], [1, 1]], 1)).toEqual([true, true]);
    expect(douglasPeucker([], 1)).toEqual([]);
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
