import { describe, expect, it } from "vitest";
import { changeBetween, FINAL_STEP, layersFor, pickSlot, STORY_LAYERS, STORY_STEPS } from "./storySteps";

describe("layersFor", () => {
  it.each([
    [0, ["ground", "area_features"]],
    [1, ["ground", "area_features", "roads"]],
    [2, ["ground", "area_features", "roads", "blocks"]],
    [3, ["ground", "area_features", "roads", "blocks", "buildings"]],
    [-4, ["ground", "area_features"]],
    [99, ["ground", "area_features", "roads", "blocks", "buildings"]],
  ])("step %i shows %j", (step, layers) => {
    expect(layersFor(step)).toEqual(layers);
  });

  it("covers every story layer by the last step, each added once", () => {
    expect(layersFor(FINAL_STEP)).toEqual([...STORY_LAYERS]);
    expect(STORY_STEPS).toHaveLength(4);
  });
});

describe("changeBetween", () => {
  it.each([
    [null, 0, ["ground", "area_features"], []],
    [0, 1, ["roads"], []],
    [0, 3, ["roads", "blocks", "buildings"], []],
    [3, 2, [], ["buildings"]],
    [3, 0, [], ["roads", "blocks", "buildings"]],
    [2, 2, [], []],
  ])("from %s to %i", (from, to, animate, hide) => {
    const change = changeBetween(from, to);
    expect(change.animate).toEqual(animate);
    expect(change.hide).toEqual(hide);
    expect(change.visible).toEqual(layersFor(to));
  });
});

type Slot = "hero" | "story";

describe("pickSlot", () => {
  it("picks the more visible slot", () => {
    expect(pickSlot<Slot>({ hero: 0.2, story: 0.7 }, null)).toBe("story");
  });
  it("picks none when neither shows", () => {
    expect(pickSlot<Slot>({ hero: 0, story: 0 }, "hero")).toBeNull();
  });
  it("stays put when the current slot is nearly as visible", () => {
    expect(pickSlot<Slot>({ hero: 0.5, story: 0.52 }, "hero")).toBe("hero");
    expect(pickSlot<Slot>({ hero: 0.3, story: 0.6 }, "hero")).toBe("story");
  });
});
