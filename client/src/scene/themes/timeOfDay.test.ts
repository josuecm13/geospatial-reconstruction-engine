import { describe, expect, it } from "vitest";
import { blendLighting, blendSky, LIGHTING, lerpHex, slerp, type Vec3 } from "./timeOfDay";
import { TIMES_OF_DAY } from "./types";

const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const elevation = (v: Vec3) => (Math.asin(v.y / length(v)) * 180) / Math.PI;
const angleBetween = (u: Vec3, v: Vec3) => Math.acos(u.x * v.x + u.y * v.y + u.z * v.z);

describe("the time-of-day presets", () => {
  it("has one for every time", () => {
    expect(Object.keys(LIGHTING).sort()).toEqual([...TIMES_OF_DAY].sort());
  });

  it.each(TIMES_OF_DAY)("%s points toward a sun above the horizon, with a unit vector", (time) => {
    const { sunDirection } = LIGHTING[time];
    expect(length(sunDirection)).toBeCloseTo(1, 6);
    expect(sunDirection.y).toBeGreaterThan(0);
  });

  it("puts the sun where each preset says", () => {
    expect(elevation(LIGHTING.dawn.sunDirection)).toBeCloseTo(8, 3);
    expect(LIGHTING.dawn.sunDirection.x).toBeGreaterThan(0.9); // east
    expect(elevation(LIGHTING.midday.sunDirection)).toBeCloseTo(65, 3);
    expect(LIGHTING.midday.sunDirection.z).toBeGreaterThan(0.2); // a little south
    expect(elevation(LIGHTING["golden-hour"].sunDirection)).toBeCloseTo(12, 3);
    expect(LIGHTING["golden-hour"].sunDirection.x).toBeLessThan(-0.9); // west
    expect(elevation(LIGHTING.night.sunDirection)).toBeCloseTo(35, 3);
  });

  it("sets night to 1 only at night", () => {
    expect(TIMES_OF_DAY.filter((time) => LIGHTING[time].night === 1)).toEqual(["night"]);
    expect(TIMES_OF_DAY.filter((time) => LIGHTING[time].night !== 0)).toEqual(["night"]);
  });

  it("makes the presets clearly different: directions, colours and intensities", () => {
    for (const a of TIMES_OF_DAY) {
      for (const b of TIMES_OF_DAY) {
        if (a >= b) continue;
        const [x, y] = [LIGHTING[a], LIGHTING[b]];
        expect(angleBetween(x.sunDirection, y.sunDirection) * (180 / Math.PI), `${a} and ${b}: sun directions`).toBeGreaterThan(20);
        expect(x.sunColor, `${a} and ${b}: sun colours`).not.toBe(y.sunColor);
        expect(x.skyColor, `${a} and ${b}: sky light colours`).not.toBe(y.skyColor);
      }
    }
    for (const day of ["dawn", "midday", "golden-hour"] as const) expect(LIGHTING.night.sunIntensity).toBeLessThan(LIGHTING[day].sunIntensity);
    expect(LIGHTING.midday.sunIntensity).toBeGreaterThan(LIGHTING.dawn.sunIntensity);
  });
});

describe("blendLighting", () => {
  const [a, b] = [LIGHTING.dawn, LIGHTING.night];

  it("is the first lighting at 0 and the second at 1", () => {
    expect(blendLighting(a, b, 0)).toEqual(a);
    const end = blendLighting(a, b, 1);
    expect(end.sunColor).toBe(b.sunColor);
    expect(end.skyColor).toBe(b.skyColor);
    expect(end.groundColor).toBe(b.groundColor);
    expect(end.sunIntensity).toBeCloseTo(b.sunIntensity, 9);
    expect(end.hemisphereIntensity).toBeCloseTo(b.hemisphereIntensity, 9);
    expect(end.night).toBe(1);
    expect(end.sunDirection.x).toBeCloseTo(b.sunDirection.x, 6);
    expect(end.sunDirection.y).toBeCloseTo(b.sunDirection.y, 6);
    expect(end.sunDirection.z).toBeCloseTo(b.sunDirection.z, 6);
  });

  it("is halfway at 0.5: numbers and colours lerped, the direction slerped to a unit vector", () => {
    const mid = blendLighting(a, b, 0.5);
    expect(mid.sunIntensity).toBeCloseTo((a.sunIntensity + b.sunIntensity) / 2, 9);
    expect(mid.hemisphereIntensity).toBeCloseTo((a.hemisphereIntensity + b.hemisphereIntensity) / 2, 9);
    expect(mid.night).toBe(0.5);
    expect(mid.sunColor).toBe(lerpHex(a.sunColor, b.sunColor, 0.5));
    expect(length(mid.sunDirection)).toBeCloseTo(1, 9); // a straight lerp of two unit vectors would be shorter
    expect(angleBetween(mid.sunDirection, a.sunDirection)).toBeCloseTo(angleBetween(mid.sunDirection, b.sunDirection), 6);
  });
});

describe("lerpHex, slerp and blendSky", () => {
  it("lerps hex colours per channel", () => {
    expect(lerpHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(lerpHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(lerpHex("#000000", "#fe0064", 0.5)).toBe("#7f0032");
  });

  it("slerps along the arc, and survives equal and opposite directions", () => {
    const [x, y] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }];
    const mid = slerp(x, y, 0.5);
    expect(mid.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(mid.y).toBeCloseTo(Math.SQRT1_2, 9);
    expect(slerp(x, x, 0.3)).toEqual(x);
    expect(Number.isFinite(length(slerp(x, { x: -1, y: 0, z: 0 }, 0.5)))).toBe(true);
  });

  it("blends the three colours of a sky", () => {
    const [a, b] = [
      { zenith: "#000000", horizon: "#000000", below: "#000000" },
      { zenith: "#ffffff", horizon: "#fefefe", below: "#101010" },
    ];
    expect(blendSky(a, b, 0)).toEqual(a);
    expect(blendSky(a, b, 1)).toEqual(b);
  });
});
