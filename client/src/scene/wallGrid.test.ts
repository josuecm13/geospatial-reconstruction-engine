import { describe, expect, it } from "vitest";
import { CELL_WIDTH, FLOOR_HEIGHT, groundCoords, wallCoords } from "./wallGrid";

describe("wallCoords", () => {
  it("runs u along a wall facing north (normal -z)", () => {
    const a = wallCoords(2, 5, 10, 0, 0, -1)!;
    const b = wallCoords(5, 5, 10, 0, 0, -1)!;
    expect(Math.abs(b.u - a.u)).toBeCloseTo(3, 9);
    expect(a.v).toBe(5);
  });

  it("runs u along a wall facing east (normal +x)", () => {
    const a = wallCoords(10, 1, 2, 1, 0, 0)!;
    const b = wallCoords(10, 1, 6, 1, 0, 0)!;
    expect(Math.abs(b.u - a.u)).toBeCloseTo(4, 9);
  });

  it("measures metres along a diagonal wall", () => {
    const s = Math.SQRT1_2;
    const a = wallCoords(0, 0, 0, s, 0, s)!;
    const b = wallCoords(3, 0, -3, s, 0, s)!; // 3*sqrt(2) metres along the wall
    expect(Math.abs(b.u - a.u)).toBeCloseTo(3 * Math.SQRT2, 9);
    // moving along the normal does not change u
    const c = wallCoords(s, 0, s, s, 0, s)!;
    expect(c.u).toBeCloseTo(a.u, 9);
  });

  it("returns null for a roof or a floor", () => {
    expect(wallCoords(1, 9, 1, 0, 1, 0)).toBeNull();
    expect(wallCoords(1, 0, 1, 0, -1, 0)).toBeNull();
  });

  it("differs by CELL_WIDTH one cell apart along a wall", () => {
    const a = wallCoords(0, 0, 4, 1, 0, 0)!;
    const b = wallCoords(0, 0, 4 + CELL_WIDTH, 1, 0, 0)!;
    expect(Math.abs(b.u - a.u)).toBeCloseTo(CELL_WIDTH, 9);
    expect(FLOOR_HEIGHT).toBe(3.2);
  });
});

describe("groundCoords", () => {
  it("divides by the tile size", () => {
    expect(groundCoords(16, 8, 8)).toEqual({ u: 2, v: 1 });
  });
});
