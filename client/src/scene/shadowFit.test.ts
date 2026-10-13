import { describe, expect, it } from "vitest";
import { fitShadow, fitStands, lightAxes, MAX_HALF_SIZE, MIN_HALF_SIZE, REFIT_FRACTION, SHADOW_OFF_DISTANCE, SHADOW_ON_FRACTION, shadowHalfSize, shadowsOn } from "./shadowFit";
import { LIGHTING } from "./themes/timeOfDay";

const MAP = 2048;
const sun = LIGHTING["golden-hour"].sunDirection;
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;

describe("fitShadow", () => {
  it("sizes the box at 0.8 times the camera's distance, rounded up to the next step of 150 * 1.25^k", () => {
    expect(fitShadow({ x: 0, y: 0, z: 0 }, 500, sun, MAP).halfSize).toBeCloseTo(150 * 1.25 ** 5, 9); // wants 400
    expect(fitShadow({ x: 0, y: 0, z: 0 }, 234.375, sun, MAP).halfSize).toBeCloseTo(187.5, 9); // wants exactly a step
  });

  it("gives the same half-size for two distances within one step", () => {
    const at = (distance: number) => fitShadow({ x: 0, y: 0, z: 0 }, distance, sun, MAP).halfSize;
    expect(at(500)).toBe(at(560)); // wants 400 and 448, both in (366.2, 457.8]
    expect(at(600)).toBeGreaterThan(at(500)); // wants 480
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
    const texel = (2 * 292.96875) / MAP; // distance 300 wants 240, which rounds up to 150 * 1.25^3
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

describe("fitStands", () => {
  const at = { x: 10, y: 0, z: -5 };
  it("holds while the target stays within a fraction of the half-size of the last fit", () => {
    expect(fitStands(at, at, 200)).toBe(true);
    expect(fitStands({ x: 10 + REFIT_FRACTION * 200, y: 0, z: -5 }, at, 200)).toBe(true);
  });
  it("lapses once the target drifts further, in any direction", () => {
    expect(fitStands({ x: 10 + REFIT_FRACTION * 200 + 1, y: 0, z: -5 }, at, 200)).toBe(false);
    expect(fitStands({ x: 10, y: 0, z: -5 - REFIT_FRACTION * 200 - 1 }, at, 200)).toBe(false);
  });
  it("scales with the half-size", () => {
    const near = { x: 10 + 30, y: 0, z: -5 };
    expect(fitStands(near, at, 150)).toBe(false);
    expect(fitStands(near, at, 400)).toBe(true);
  });
});

describe("shadowHalfSize", () => {
  it("is what fitShadow uses, clamped", () => {
    expect(shadowHalfSize(500)).toBe(fitShadow({ x: 0, y: 0, z: 0 }, 500, sun, MAP).halfSize);
    expect(shadowHalfSize(1e6)).toBe(MAX_HALF_SIZE);
  });
});

describe("shadowsOn", () => {
  it("puts the threshold where the box makes a texel pass about a metre: 1280 m, short of the 1500 m cap", () => {
    expect(SHADOW_OFF_DISTANCE).toBe(1280);
    // The box half-size there is 1024 m wanted, 1117.6 m quantised: a texel of 2 * 1117.6 / 2048 = 1.09 m.
    expect((2 * shadowHalfSize(SHADOW_OFF_DISTANCE)) / MAP).toBeLessThan(1.1);
    expect(shadowHalfSize(SHADOW_OFF_DISTANCE)).toBeLessThan(MAX_HALF_SIZE);
  });

  it("turns off past the threshold and on below the band, whatever it was", () => {
    expect(shadowsOn(SHADOW_OFF_DISTANCE + 1, true)).toBe(false);
    expect(shadowsOn(SHADOW_OFF_DISTANCE + 1, false)).toBe(false);
    expect(shadowsOn(SHADOW_OFF_DISTANCE * SHADOW_ON_FRACTION - 1, false)).toBe(true);
    expect(shadowsOn(SHADOW_OFF_DISTANCE * SHADOW_ON_FRACTION - 1, true)).toBe(true);
    expect(shadowsOn(0, false)).toBe(true);
  });

  it("holds its state inside the hysteresis band, so a camera hovering at the threshold doesn't flip", () => {
    const inside = SHADOW_OFF_DISTANCE * 0.95;
    expect(shadowsOn(inside, true)).toBe(true);
    expect(shadowsOn(inside, false)).toBe(false);
    expect(shadowsOn(SHADOW_OFF_DISTANCE, true)).toBe(true); // exactly at it is not past it
    // Walking out and back in: off at 1300, still off at 1200, on again at 1100.
    let on = true;
    const states = [1000, 1300, 1200, 1100, 1200, 1281].map((distance) => (on = shadowsOn(distance, on)));
    expect(states).toEqual([true, false, false, true, true, false]);
  });
});
