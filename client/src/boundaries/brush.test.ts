import { describe, expect, it } from "vitest";
import type { BoundingBox, Position } from "../api/types";
import { metersPerDegree } from "../geo/localMeters";
import { ringProblem } from "./boundaryGeometry";
import { BrushPainting, circlePolygon, clipRingToBbox, clipToBox, outlineOf, paintFootprint, shapeArea, strokeFootprint, type Multi } from "./brush";

const W = 40;
const disc = Math.PI * (W / 2) ** 2;
const within = (actual: number, expected: number, fraction: number) => Math.abs(actual - expected) / expected < fraction;

describe("strokeFootprint", () => {
  it("covers length x width plus a disc for a straight stroke", () => {
    expect(within(shapeArea(strokeFootprint([[0, 0], [100, 0]], W)), 100 * W + disc, 0.005)).toBe(true);
  });
  it("is a disc for a single point", () => {
    expect(within(shapeArea(strokeFootprint([[5, 5]], W)), disc, 0.005)).toBe(true);
  });
  it("keeps the same area however a straight stroke is split into points", () => {
    const whole = shapeArea(strokeFootprint([[0, 0], [100, 0]], W));
    const split = shapeArea(strokeFootprint([[0, 0], [30, 0], [70, 0], [100, 0]], W));
    expect(within(split, whole, 0.001)).toBe(true);
  });
  it("is empty for no points", () => {
    expect(strokeFootprint([], W)).toEqual([]);
  });
});

describe("paintFootprint", () => {
  const bar = strokeFootprint([[0, 0], [100, 0]], W);
  const cross = strokeFootprint([[50, -50], [50, 50]], W);
  it("merges overlapping strokes into one part with the union's area", () => {
    const merged = paintFootprint(bar, cross, false);
    expect(merged).toHaveLength(1);
    // The two bars share a W x W square, plus nothing else.
    expect(within(shapeArea(merged), shapeArea(bar) + shapeArea(cross) - W * W, 0.01)).toBe(true);
  });
  it("keeps far apart strokes as separate parts", () => {
    expect(paintFootprint(bar, strokeFootprint([[0, 500], [100, 500]], W), false)).toHaveLength(2);
  });
  it("subtracts when erasing, and an erase over nothing changes nothing", () => {
    const erased = paintFootprint(bar, cross, true);
    expect(erased).toHaveLength(2); // the cut splits the bar in two
    expect(shapeArea(erased)).toBeLessThan(shapeArea(bar) - W * W * 0.9);
    expect(shapeArea(paintFootprint(bar, strokeFootprint([[0, 900]], W), true))).toBeCloseTo(shapeArea(bar), 3);
  });
});

describe("clipToBox", () => {
  it("cuts a shape to the box", () => {
    const shape = strokeFootprint([[0, 0], [100, 0]], W);
    expect(within(shapeArea(clipToBox(shape, [-1000, -1000, 50, 1000])), 50 * W + disc / 2, 0.01)).toBe(true);
    expect(clipToBox(shape, [500, 500, 600, 600])).toEqual([]);
  });
});

describe("outlineOf", () => {
  it("returns the closed ring of the largest part, noting what was dropped", () => {
    const shape: Multi = paintFootprint(strokeFootprint([[0, 0], [100, 0]], W), strokeFootprint([[0, 500]], 10), false);
    const { ring, droppedParts, filledHoles } = outlineOf(shape);
    expect(droppedParts).toBe(1);
    expect(filledHoles).toBe(false);
    expect(ring![0]).toEqual(ring![ring!.length - 1]);
    expect(ring!.every(([, y]) => Math.abs(y) < 30)).toBe(true);
  });
  it("keeps only the outer ring of a part with a hole, and says so", () => {
    const outer = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]] as [number, number][];
    const hole = [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]] as [number, number][];
    const { ring, filledHoles } = outlineOf([[outer, hole]]);
    expect(filledHoles).toBe(true);
    expect(ring).toHaveLength(5);
  });
  it("is empty for an empty shape", () => {
    expect(outlineOf([]).ring).toBeNull();
  });
  it("circle polygons are closed", () => {
    const circle = circlePolygon([0, 0], 10);
    expect(circle[0]).toEqual(circle[circle.length - 1]);
  });
});

describe("BrushPainting", () => {
  const lat = 40;
  const per = metersPerDegree(lat);
  const at = (xMeters: number, yMeters = 0): Position => [-3 + xMeters / per.lon, lat + yMeters / per.lat];
  const bbox: BoundingBox = { min_latitude: lat - 1, max_latitude: lat + 1, min_longitude: -4, max_longitude: -2 };

  it("paints a stroke of the given width and outlines it as a valid ring", () => {
    const brush = new BrushPainting();
    brush.begin(at(0), W, false);
    brush.extend(at(50));
    brush.extend(at(100));
    brush.end();
    expect(within(shapeArea(brush.shape), 100 * W + disc, 0.01)).toBe(true);
    expect(ringProblem(brush.outline().ring!, bbox)).toBeNull();
  });
  it("merges strokes, erases, and undoes stroke by stroke", () => {
    const brush = new BrushPainting();
    brush.begin(at(0), W, false);
    brush.extend(at(100));
    brush.end();
    const first = shapeArea(brush.shape);
    brush.begin(at(50, -60), W, false);
    brush.extend(at(50, 60));
    brush.end();
    expect(brush.shape).toHaveLength(1);
    const merged = shapeArea(brush.shape);
    expect(merged).toBeGreaterThan(first);
    brush.begin(at(50, -60), W, true);
    brush.extend(at(50, 60));
    brush.end();
    expect(shapeArea(brush.shape)).toBeLessThan(first);
    brush.undo();
    expect(within(shapeArea(brush.shape), merged, 0.001)).toBe(true);
    brush.undo();
    expect(within(shapeArea(brush.shape), first, 0.001)).toBe(true);
    brush.undo();
    expect(brush.isEmpty).toBe(true);
    expect(brush.canUndo).toBe(false);
  });
  it("starts over after clear", () => {
    const brush = new BrushPainting();
    brush.begin(at(0), W, false);
    brush.end();
    brush.clear();
    expect(brush.isEmpty).toBe(true);
    expect(brush.lonLatShape()).toEqual([]);
    expect(brush.outline().ring).toBeNull();
  });
});

describe("clipRingToBbox", () => {
  const bbox: BoundingBox = { min_latitude: 40, max_latitude: 40.01, min_longitude: -3, max_longitude: -2.99 };
  it("leaves a ring inside the box as it was", () => {
    const ring: Position[] = [[-2.998, 40.002], [-2.992, 40.002], [-2.992, 40.008], [-2.998, 40.008], [-2.998, 40.002]];
    const { ring: out, droppedParts } = clipRingToBbox(ring, bbox);
    expect(droppedParts).toBe(0);
    expect(out).toHaveLength(5);
    expect(ringProblem(out!, bbox)).toBeNull();
  });
  it("cuts a ring that sticks out so the result lies inside the box", () => {
    const ring: Position[] = [[-3.005, 40.002], [-2.992, 40.002], [-2.992, 40.008], [-3.005, 40.008], [-3.005, 40.002]];
    const { ring: out } = clipRingToBbox(ring, bbox);
    expect(Math.min(...out!.map(([lon]) => lon))).toBe(bbox.min_longitude);
    expect(ringProblem(out!, bbox)).toBeNull();
  });
  it("returns no ring when the shape is wholly outside", () => {
    const ring: Position[] = [[-2.9, 40.5], [-2.8, 40.5], [-2.8, 40.6], [-2.9, 40.5]];
    expect(clipRingToBbox(ring, bbox).ring).toBeNull();
  });
});
