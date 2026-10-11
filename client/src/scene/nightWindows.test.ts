import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DENSITY_GENERATED, DENSITY_REAL, PATCH_ANCHORS, windowLit, windowNight } from "./nightWindows";

const chunk = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../node_modules/three/src/renderers/shaders/ShaderLib/${name}.glsl.js`, import.meta.url)), "utf8");

describe("three.js shader anchors", () => {
  // Basic and Lambert both run these chunks; a three.js upgrade that renames one would silently draw no windows.
  for (const name of ["meshbasic", "meshlambert"]) {
    const source = chunk(name);
    const [vertex, fragment] = source.split("export const fragment");
    it(`${name} has the vertex anchors`, () => {
      expect(vertex).toContain(PATCH_ANCHORS.vertexCommon);
      expect(vertex).toContain(PATCH_ANCHORS.vertexBegin);
    });
    it(`${name} has the fragment anchors`, () => {
      expect(fragment).toContain(PATCH_ANCHORS.fragmentCommon);
      expect(fragment).toContain(PATCH_ANCHORS.fragmentEnd);
    });
  }
});

describe("windowLit", () => {
  const share = (density: number) => {
    let lit = 0;
    let total = 0;
    for (let x = -50; x < 50; x++)
      for (let y = 0; y < 60; y++)
        for (let plane = 0; plane < 3; plane++) {
          total++;
          if (windowLit(x, y, plane, density)) lit++;
        }
    return lit / total;
  };
  it("lights about the density of cells", () => {
    expect(Math.abs(share(DENSITY_REAL) - DENSITY_REAL)).toBeLessThan(0.03);
    expect(Math.abs(share(DENSITY_GENERATED) - DENSITY_GENERATED)).toBeLessThan(0.03);
  });
  it("is deterministic", () => {
    expect(windowLit(3, 4, 5, 0.25)).toBe(windowLit(3, 4, 5, 0.25));
  });
});

describe("windowNight", () => {
  it("follows the theme's window mode", () => {
    expect(windowNight("always", 0)).toBe(1);
    expect(windowNight("night", 0.4)).toBe(0.4);
    expect(windowNight("never", 1)).toBe(0);
  });
});
