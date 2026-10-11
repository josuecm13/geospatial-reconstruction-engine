import { describe, expect, it } from "vitest";
import { bodyFor, changeBetween, FINAL_STEP, hasGeneratedContext, heroStep, layersFor, pickSlot, STORY_LAYERS, STORY_STEPS } from "./storySteps";

describe("layersFor", () => {
  it.each([
    [0, ["ground", "area_features"]],
    [1, ["ground", "area_features", "roads"]],
    [2, ["ground", "area_features", "roads", "blocks"]],
    [3, ["ground", "area_features", "roads", "blocks", "buildings"]],
    [4, ["ground", "area_features", "roads", "blocks", "buildings", "generated"]],
    [-4, ["ground", "area_features"]],
    [99, ["ground", "area_features", "roads", "blocks", "buildings", "generated"]],
  ])("step %i shows %j", (step, layers) => {
    expect(layersFor(step)).toEqual(layers);
  });

  it("covers every story layer by the last step, each added once", () => {
    expect(layersFor(FINAL_STEP)).toEqual([...STORY_LAYERS]);
    expect(STORY_STEPS).toHaveLength(5);
  });
});

describe("changeBetween", () => {
  it.each([
    [null, 0, ["ground", "area_features"], []],
    [0, 1, ["roads"], []],
    [0, 3, ["roads", "blocks", "buildings"], []],
    [0, 4, ["roads", "blocks", "buildings", "generated"], []],
    [3, 4, ["generated"], []],
    [4, 3, [], ["generated"]],
    [3, 2, [], ["buildings"]],
    [4, 0, [], ["roads", "blocks", "buildings", "generated"]],
    [2, 2, [], []],
  ])("from %s to %i", (from, to, animate, hide) => {
    const change = changeBetween(from, to);
    expect(change.animate).toEqual(animate);
    expect(change.hide).toEqual(hide);
    expect(change.visible).toEqual(layersFor(to));
  });
});

describe("heroStep", () => {
  it("shows the generated layer when the place has one", () => {
    expect(heroStep(true)).toBe(FINAL_STEP);
    expect(layersFor(heroStep(true))).toContain("generated");
  });
  it("shows the buildings step when it has none", () => {
    expect(heroStep(false)).toBe(FINAL_STEP - 1);
    expect(layersFor(heroStep(false))).not.toContain("generated");
  });
});

describe("hasGeneratedContext", () => {
  const features = [{}];
  it("needs a run and at least one building", () => {
    expect(hasGeneratedContext({ generation: {}, generated_buildings: { features } })).toBe(true);
    expect(hasGeneratedContext({ generation: null, generated_buildings: { features } })).toBe(false);
    expect(hasGeneratedContext({ generation: {}, generated_buildings: { features: [] } })).toBe(false);
  });
});

describe("bodyFor", () => {
  const generated = STORY_STEPS[FINAL_STEP];
  it("points to Generate on the generated step only when there is no run", () => {
    expect(bodyFor(generated, false).notGenerated).toBe(true);
    expect(bodyFor(generated, true).notGenerated).toBe(false);
    expect(bodyFor(STORY_STEPS[0], false).notGenerated).toBe(false);
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
