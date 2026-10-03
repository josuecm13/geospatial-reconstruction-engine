import { describe, expect, it } from "vitest";
import { blocked, buildFootprintIndex, circleHitsRing, nearestRoadStart, resolveMove, type Point } from "./collision";

const square: Point[] = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];
const index = buildFootprintIndex([{ id: "b", ring: square }]);

describe("resolveMove", () => {
  it("blocks a move from outside into the building", () => {
    expect(resolveMove(index, { x: -2, z: 5 }, { x: 5, z: 5 })).toEqual({ x: -2, z: 5 });
  });

  it("slides along the wall on the free axis", () => {
    // Moving diagonally into the west wall: x is blocked, z is free.
    expect(resolveMove(index, { x: -1, z: 5 }, { x: 1, z: 6 })).toEqual({ x: -1, z: 6 });
  });

  it("blocks a corner clipped within the radius", () => {
    expect(blocked(index, { x: 10.2, z: 10.2 })).toBe(true);
    // The diagonal step is refused; moving along x alone ends 1.02 m from the corner, which is free.
    expect(resolveMove(index, { x: 11, z: 11 }, { x: 10.2, z: 10.2 })).toEqual({ x: 10.2, z: 11 });
  });

  it("leaves a far-away move untouched", () => {
    const to = { x: 200, z: -300 };
    expect(resolveMove(index, { x: 199, z: -300 }, to)).toBe(to);
  });
});

describe("nearestRoadStart", () => {
  it("picks the centroid of the closest outline", () => {
    const far = [{ x: 100, z: 100 }, { x: 102, z: 100 }, { x: 102, z: 102 }, { x: 100, z: 102 }];
    const near = [{ x: 4, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 2 }, { x: 4, z: 2 }];
    expect(nearestRoadStart([far, near])).toEqual({ x: 5, z: 1 });
  });

  it("falls back to the centre without roads", () => {
    expect(nearestRoadStart([], { x: 3, z: 4 })).toEqual({ x: 3, z: 4 });
  });
});

describe("footprint index", () => {
  it("agrees with a brute-force check", () => {
    let seed = 42;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const footprints = Array.from({ length: 30 }, (_, i) => {
      const x = random() * 200;
      const z = random() * 200;
      const w = 3 + random() * 40;
      return { id: String(i), ring: [{ x, z }, { x: x + w, z }, { x: x + w, z: z + w }, { x, z: z + w }] };
    });
    const grid = buildFootprintIndex(footprints, 25);
    for (let i = 0; i < 500; i++) {
      const p = { x: random() * 260 - 20, z: random() * 260 - 20 };
      const brute = footprints.some((f) => circleHitsRing(p, f.ring, 0.3));
      expect(blocked(grid, p)).toBe(brute);
    }
  });
});
