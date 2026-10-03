import { describe, expect, it } from "vitest";
import { dedupeTwins, roadPolygon } from "./roadGeometry";

describe("roadPolygon", () => {
  it("draws a straight road as a strip of the given width", () => {
    const outline = roadPolygon([{ x: 0, z: 0 }, { x: 10, z: 0 }], 6);
    expect(outline).toHaveLength(4);
    const zs = outline.map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(6);
    const xs = outline.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(10);
  });

  it("mitres a 90 degree corner", () => {
    const outline = roadPolygon([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }], 4);
    expect(outline).toHaveLength(6);
    // The outer and inner corners sit half-width off the centerline on both axes.
    const has = (x: number, z: number) => outline.some((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.z - z) < 1e-9);
    expect(has(12, -2) || has(8, -2)).toBe(true);
    expect(has(8, 2) || has(12, 2)).toBe(true);
  });

  it("bevels a very sharp turn instead of spiking", () => {
    const outline = roadPolygon([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 0.5 }], 2);
    // A miter here would reach about 40 m past the apex at x = 10; a bevel stays within half the width.
    for (const p of outline) expect(p.x).toBeLessThanOrEqual(10 + 1 + 1e-9);
    expect(outline.length).toBeGreaterThan(6);
  });

  it("returns nothing for fewer than two distinct points", () => {
    expect(roadPolygon([], 4)).toEqual([]);
    expect(roadPolygon([{ x: 1, z: 1 }], 4)).toEqual([]);
    expect(roadPolygon([{ x: 1, z: 1 }, { x: 1, z: 1 }], 4)).toEqual([]);
  });
});

describe("dedupeTwins", () => {
  const forward = { street: "a", line: [{ x: 0, z: 0 }, { x: 5, z: 0 }] };
  const reverse = { street: "a", line: [{ x: 5, z: 0 }, { x: 0, z: 0 }] };
  const otherStreet = { street: "b", line: [{ x: 5, z: 0 }, { x: 0, z: 0 }] };
  const run = (items: (typeof forward)[]) =>
    dedupeTwins(
      items,
      (i) => i.street,
      (i) => [i.line],
    );

  it("keeps one of a forward and reverse pair", () => {
    expect(run([forward, reverse])).toEqual([forward]);
  });

  it("keeps the same geometry on a different street", () => {
    expect(run([forward, otherStreet])).toHaveLength(2);
  });
});
