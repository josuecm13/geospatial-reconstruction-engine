import { describe, expect, it } from "vitest";
import { viewFromHash } from "./viewState";

describe("viewFromHash", () => {
  it.each([
    ["#map", "map"],
    ["#scene", "scene"],
    ["#scene/area/1", "scene"],
    ["", "map"],
    ["#unknown", "map"],
  ])("%s → %s", (hash, expected) => {
    expect(viewFromHash(hash)).toBe(expected);
  });
});

describe("INITIAL_VIEW", () => {
  it("is the map, so the scene is never built on load", async () => {
    const { INITIAL_VIEW } = await import("./viewState");
    expect(INITIAL_VIEW).toBe("map");
  });
});
