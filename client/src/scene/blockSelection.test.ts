// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Feature, MapData, Position } from "../api/types";
import { buildWorld } from "./buildWorld";
import { blockAt } from "./blockOutline";
import { createBlockSelection } from "./blockSelection";
import { MATERIALS } from "./palette";

const D = 0.0001; // about 11 m
const square = (lon: number, lat: number): Position[][] => [[[lon, lat], [lon + D, lat], [lon + D, lat + D], [lon, lat + D], [lon, lat]]];
const fc = <P>(features: Feature<P>[]) => ({ type: "FeatureCollection" as const, features });
const block = (id: string, lat: number, eligibility: "eligible" | "median" = "eligible", buildable = true) =>
  ({
    type: "Feature",
    id,
    geometry: { type: "Polygon", coordinates: square(-84, lat) },
    properties: {
      area_square_meters: 100,
      buildable_area: buildable ? { type: "Polygon", coordinates: square(-84, lat) } : null,
      buildable_area_square_meters: buildable ? 90 : 0,
      is_median: eligibility === "median",
      is_clipped: false,
      import_area_id: "a1",
      eligibility,
      real_building_count: 2,
      generated_building_count: 0,
      is_reference: false,
      reference_block_id: null,
      style: null,
      feedback: null,
    },
  }) as MapData["blocks"]["features"][number];

const data = (blocks: MapData["blocks"]["features"]): MapData => ({
  attribution: "",
  scope: { type: "import_area", id: "a1", composed_area_ids: [] },
  mode: "filter",
  projection: { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 },
  road_segments: fc([]),
  navigable_nodes: fc([]),
  blocks: fc(blocks),
  buildings: fc([]),
  pois: fc([]),
  area_features: fc([]),
  generation: null,
  generated_buildings: fc([]),
  generation_zones: fc([]),
  elevation: null,
});

describe("blockAt", () => {
  const index = [
    { id: "a", polygons: [[[{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]]] },
    { id: "b", polygons: [[[{ x: 20, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 10 }, { x: 20, z: 10 }]]] },
  ];

  it("finds the block containing the point, or null on a road", () => {
    expect(blockAt(index, 5, 5)).toBe("a");
    expect(blockAt(index, 25, 5)).toBe("b");
    expect(blockAt(index, 15, 5)).toBeNull();
    expect(blockAt([], 5, 5)).toBeNull();
  });
});

describe("createBlockSelection", () => {
  /** A camera looking straight down at the first block's centre, 100 x 100 px canvas: a click at its centre lands on that block (x 0 to 10.9, z -11 to 0). */
  function setup(blocks = [block("b1", 10), block("b2", 10.0003, "median", false)]) {
    const world = buildWorld(data(blocks));
    const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
    camera.position.set(5.45, 100, -5.5);
    camera.lookAt(5.45, 0, -5.5);
    camera.updateMatrixWorld();
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    const container = document.createElement("div");
    let canSelect = true;
    const selection = createBlockSelection(camera, canvas, container, { putBlockFeedback: async () => ({ building_count: 1, no_buildings: false, updated_at: "t" }), deleteBlockFeedback: async () => undefined }, () => canSelect);
    selection.setWorld(world);
    selection.setActive(true);
    const click = (x = 50, y = 50, button = 0) => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y, button }));
      canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y, button }));
    };
    const panel = () => container.querySelector(".block-panel") as HTMLElement;
    const material = (id: string) => (world.getObjectByName(`block_outline:${id}`) as THREE.Line).material;
    const drag = () => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 50, clientY: 50, button: 0 }));
      canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 60, button: 0 }));
    };
    return { world, selection, click, drag, panel, material, setCanSelect: (value: boolean) => (canSelect = value) };
  }

  it("selects the block under a click: panel open, outline solid and highlighted", () => {
    const { selection, click, panel, material } = setup();
    selection.setEnabled(true);

    click();

    expect(panel().hidden).toBe(false);
    expect(panel().querySelector(".block-summary")!.textContent).toContain("real: 2");
    expect(material("b1")).toBe(MATERIALS.blockOutlineSelected);
    expect(material("b2")).toBe(MATERIALS.blockOutlineFaint); // not selected, a median: still faint
  });

  it("does nothing while Show blocks is off", () => {
    const { click, panel, material } = setup();

    click();

    expect(panel().hidden).toBe(true);
    expect(material("b1")).toBe(MATERIALS.blockOutline);
  });

  it("deselects on a click that lands on no block, and puts the outline back", () => {
    const { selection, click, panel, material } = setup();
    selection.setEnabled(true);
    click();

    click(65, 65); // the ground 15 m off, outside every block

    expect(panel().hidden).toBe(true);
    expect(material("b1")).toBe(MATERIALS.blockOutline);
  });

  it("ignores a drag, a right click, and a click while the host says no", () => {
    const { selection, click, drag, panel, setCanSelect } = setup();
    selection.setEnabled(true);

    drag();
    expect(panel().hidden).toBe(true);
    click(50, 50, 2);
    expect(panel().hidden).toBe(true);
    setCanSelect(false);
    click();
    expect(panel().hidden).toBe(true);
  });

  it("deselects on Escape while the scene is active, and not otherwise", () => {
    const { selection, click, panel } = setup();
    selection.setEnabled(true);
    click();
    selection.setActive(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel().hidden).toBe(false);
    selection.setActive(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel().hidden).toBe(true);
  });

  it("deselects when Show blocks is turned off, and when a new world is loaded", () => {
    const { selection, click, panel, world } = setup();
    selection.setEnabled(true);
    click();
    selection.setEnabled(false);
    expect(panel().hidden).toBe(true);

    selection.setEnabled(true);
    click();
    expect(panel().hidden).toBe(false);
    selection.setWorld(world);
    expect(panel().hidden).toBe(true);
  });

  it("selects a block with no buildable area, which has no fill to click", () => {
    const { selection, click, panel, world } = setup([block("n", 10, "median", false)]);
    selection.setEnabled(true);

    click();

    expect(world.getObjectByName("block:n")).toBeUndefined();
    expect(panel().hidden).toBe(false);
    expect(panel().querySelector(".block-reason")!.textContent).toContain("median");
  });
});
