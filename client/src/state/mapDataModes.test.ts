import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const mapDataCalls = (path: string) => source(path).match(/\bapi\s*\.mapData\([^)]*\)/g) ?? [];

// The renderers draw the area, so they ask for geometry cut at the scope. The 2D map inspects and picks whole features.
describe("map-data modes", () => {
  it.each([
    ["landing/featuredStage.ts", "CLIPPED"],
    ["landing/bento.ts", "CLIPPED"],
    ["pages/landing.ts", "CLIPPED"],
    ["locations/preview.ts", "CLIPPED"],
    ["scene/sceneLoader.ts", "renderMapDataQuery"],
  ])("%s requests clip mode", (path, query) => {
    const calls = mapDataCalls(path);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain(query);
  });

  it("the 2D map keeps filter mode", () => {
    const calls = mapDataCalls("importing/importPanel.ts");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).not.toMatch(/clip|CLIPPED|renderMapDataQuery/i);
  });
});
