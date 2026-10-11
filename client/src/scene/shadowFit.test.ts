import { describe, expect, it } from "vitest";
import { fitShadow, lightAxes, MAX_HALF_SIZE, MIN_HALF_SIZE } from "./shadowFit";
import { LIGHTING } from "./themes/timeOfDay";

const MAP = 2048;
const sun = LIGHTING["golden-hour"].sunDirection;
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;

describe("fitShadow", () => {
  it("sizes the box at 0.8 times the camera's distance", () => {
    expect(fitShadow({ x: 0, y: 0, z: 0 }, 500, sun, MAP).halfSize).toBeCloseTo(400, 9);
  });

  it("clamps the half-size to 150-1500 m", () => {
    expect(fitShadow({ x: 0, y: 0, z: 0 }, 10, sun, MAP).halfSize).toBe(MIN_HALF_SIZE);
    expect(fitShadow({ x: 0, y: 0, z: 0 }, 0, sun, MAP).halfSize).toBe(150);
    expect(fitShadow({ x: 0, y: 0, z: 0 }, 100_000, sun, MAP).halfSize).toBe(MAX_HALF_SIZE);
    expect(fitShadow({ x: 0, y: 0, z: 0 }, 1875, sun, MAP).halfSize).toBe(1500);
  });

  it("snaps the centre to whole texels across the light's view, moving it by less than a texel", () => {
    const { right, up } = lightAxes(sun);
    const target = { x: 123.456, y: 17.5, z: -987.654 };
    const { centre, halfSize } = fitShadow(target, 500, sun, MAP);
    const texel = (2 * halfSize) / MAP;
    for (const axis of [right, up]) {
      const along = dot(centre, axis) / texel;
      expect(Math.abs(along - Math.round(along)), "a whole number of texels").toBeLessThan(1e-6);
      expect(Math.abs(dot(centre, axis) - dot(target, axis))).toBeLessThanOrEqual(texel / 2 + 1e-9);
    }
  });

  it("keeps the depth of the target along the sun's direction", () => {
    const target = { x: 40.3, y: 12, z: 77.7 };
    const { centre } = fitShadow(target, 300, sun, MAP);
    expect(dot(centre, sun)).toBeCloseTo(dot(target, sun), 6);
  });

  it("moves the centre in whole texels only: by at most one for a tiny move, and by about the move for a larger one", () => {
    const { right } = lightAxes(sun);
    const texel = (2 * 240) / MAP; // distance 300 gives a half-size of 240
    const base = { x: 10, y: 0, z: 10 };
    const nudge = (amount: number) => ({ x: base.x + right.x * amount, y: base.y + right.y * amount, z: base.z + right.z * amount });
    const a = fitShadow(base, 300, sun, MAP).centre;
    const b = fitShadow(nudge(texel * 0.01), 300, sun, MAP).centre;
    const c = fitShadow(nudge(texel * 1.5), 300, sun, MAP).centre;
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(texel * 1.0001);
    expect(Math.hypot(c.x - a.x, c.z - a.z)).toBeGreaterThan(texel * 0.9);
  });

  it("works for a sun straight overhead", () => {
    const { centre } = fitShadow({ x: 5, y: 0, z: 5 }, 300, { x: 0, y: 1, z: 0 }, MAP);
    expect(Number.isFinite(centre.x + centre.y + centre.z)).toBe(true);
  });
});

describe("lightAxes", () => {
  it("are unit vectors at right angles to each other and to the sun", () => {
    const { right, up } = lightAxes(sun);
    expect(dot(right, right)).toBeCloseTo(1, 9);
    expect(dot(up, up)).toBeCloseTo(1, 9);
    expect(dot(right, up)).toBeCloseTo(0, 9);
    expect(dot(right, sun)).toBeCloseTo(0, 9);
    expect(dot(up, sun)).toBeCloseTo(0, 9);
  });
});
