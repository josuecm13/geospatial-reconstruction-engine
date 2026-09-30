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
