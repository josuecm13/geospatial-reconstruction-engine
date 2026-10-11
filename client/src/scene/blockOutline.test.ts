import { describe, expect, it } from "vitest";
import { densify, hasBlockFill, insetRing, outlineKind, OUTLINE_INSET, pointInRings } from "./blockOutline";

describe("hasBlockFill", () => {
  it("fills an eligible block and one with no eligibility, and nothing else", () => {
    expect(hasBlockFill({ eligibility: "eligible" })).toBe(true);
    expect(hasBlockFill({})).toBe(true);
    expect(hasBlockFill({ eligibility: null })).toBe(true);
    for (const eligibility of ["clipped", "median", "no_buildable_area"] as const) expect(hasBlockFill({ eligibility }), eligibility).toBe(false);
  });
});
import type { Local } from "./projection";

const rect = (x0: number, z0: number, x1: number, z1: number): Local[] => [
  { x: x0, z: z0 },
  { x: x1, z: z0 },
  { x: x1, z: z1 },
  { x: x0, z: z1 },
  { x: x0, z: z0 },
];
const bounds = (ring: Local[]) => ({
  minX: Math.min(...ring.map((p) => p.x)),
  maxX: Math.max(...ring.map((p) => p.x)),
  minZ: Math.min(...ring.map((p) => p.z)),
  maxZ: Math.max(...ring.map((p) => p.z)),
});

describe("insetRing", () => {
  it("moves every edge of a rectangle inward by 1.5 m, and closes the ring", () => {
    const inset = insetRing(rect(0, 0, 20, 10));

    expect(OUTLINE_INSET).toBe(1.5);
    expect(bounds(inset)).toEqual({ minX: 1.5, maxX: 18.5, minZ: 1.5, maxZ: 8.5 });
    expect(inset).toHaveLength(5);
    expect(inset[0]).toEqual(inset[4]);
  });

  it("insets inward whichever way the ring winds", () => {
    const reversed = rect(0, 0, 20, 10).reverse();

    expect(bounds(insetRing(reversed))).toEqual({ minX: 1.5, maxX: 18.5, minZ: 1.5, maxZ: 8.5 });
  });

  it("takes a ring without its closing point the same way", () => {
    expect(bounds(insetRing(rect(0, 0, 20, 10).slice(0, 4)))).toEqual({ minX: 1.5, maxX: 18.5, minZ: 1.5, maxZ: 8.5 });
  });

  it("takes a custom distance", () => {
    expect(bounds(insetRing(rect(0, 0, 20, 20), 4))).toEqual({ minX: 4, maxX: 16, minZ: 4, maxZ: 16 });
  });

  it("keeps an L-shaped block's reflex corner inside it", () => {
    const l: Local[] = [
      { x: 0, z: 0 },
      { x: 20, z: 0 },
      { x: 20, z: 10 },
      { x: 10, z: 10 },
      { x: 10, z: 20 },
      { x: 0, z: 20 },
      { x: 0, z: 0 },
    ];
    const inset = insetRing(l);

    expect(inset).toHaveLength(7);
    // The reflex corner (10, 10) moves into the L: its two inset edges are x = 8.5 and z = 8.5.
    expect(inset[3].x).toBeCloseTo(8.5, 6);
    expect(inset[3].z).toBeCloseTo(8.5, 6);
    expect(inset[0].x).toBeCloseTo(1.5, 6);
    expect(inset[0].z).toBeCloseTo(1.5, 6);
  });

  it("returns a ring too narrow to inset unchanged, still closed", () => {
    const narrow = rect(0, 0, 20, 2);

    expect(insetRing(narrow)).toEqual(narrow);
    expect(insetRing(rect(0, 0, 20, 2).slice(0, 4))).toEqual(narrow);
  });

  it("returns a degenerate ring as it is", () => {
    expect(insetRing([])).toEqual([]);
    expect(insetRing([{ x: 0, z: 0 }, { x: 1, z: 0 }])).toHaveLength(3);
  });
});

describe("densify", () => {
  it("splits long edges so none is longer than the step, keeping every original vertex", () => {
    const ring = rect(0, 0, 10, 4);
    const dense = densify(ring, 3);

    expect(dense[0]).toEqual(ring[0]);
    expect(dense[dense.length - 1]).toEqual(ring[4]);
    for (let i = 1; i < dense.length; i++) expect(Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z)).toBeLessThanOrEqual(3 + 1e-9);
    for (const corner of ring) expect(dense.some((p) => p.x === corner.x && p.z === corner.z)).toBe(true);
    // 10 -> 4 parts, 4 -> 2 parts, twice: 12 edges, 13 points.
    expect(dense).toHaveLength(13);
  });

  it("leaves a ring whose edges are short enough as it is", () => {
    expect(densify(rect(0, 0, 2, 2), 5)).toHaveLength(5);
  });

  it("does nothing without a positive step", () => {
    const ring = rect(0, 0, 10, 10);

    expect(densify(ring, 0)).toBe(ring);
  });
});

describe("pointInRings", () => {
  const square = rect(0, 0, 10, 10);
  const hole = rect(4, 4, 6, 6);

  it("is true inside the outer ring and false outside it", () => {
    expect(pointInRings(5, 5, [square])).toBe(true);
    expect(pointInRings(11, 5, [square])).toBe(false);
    expect(pointInRings(5, -1, [square])).toBe(false);
  });

  it("excludes the holes", () => {
    expect(pointInRings(5, 5, [square, hole])).toBe(false);
    expect(pointInRings(2, 2, [square, hole])).toBe(true);
  });

  it("is false for no rings", () => {
    expect(pointInRings(0, 0, [])).toBe(false);
  });
});

describe("outlineKind", () => {
  it("is crisp for an eligible block, and for one with no eligibility given", () => {
    expect(outlineKind({ eligibility: "eligible", is_reference: false })).toBe("crisp");
    expect(outlineKind({})).toBe("crisp");
  });

  it("is faint for every other eligibility", () => {
    for (const eligibility of ["clipped", "median", "no_buildable_area"] as const) expect(outlineKind({ eligibility }), eligibility).toBe("faint");
  });

  it("marks a reference block", () => {
    expect(outlineKind({ eligibility: "eligible", is_reference: true })).toBe("reference");
  });

  it("is selected when selected, whatever the block is", () => {
    expect(outlineKind({ eligibility: "median" }, true)).toBe("selected");
    expect(outlineKind({ eligibility: "eligible", is_reference: true }, true)).toBe("selected");
  });
});
