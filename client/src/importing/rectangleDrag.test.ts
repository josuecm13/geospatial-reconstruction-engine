import { describe, expect, it } from "vitest";
import type { BoundingBox } from "../api/types";
import { applyDrag, cursorFor, describeSize, hitTest, metersPerPixel, MIN_SIZE_METERS, sizeLabel } from "./rectangleDrag";

// At the equator a degree is the same length either way: M = 6_371_000 * pi / 180 = 111194.9266 m.
// Every rectangle here sits within 0.001 degrees of the equator, so cos(latitude) differs from 1
// by under 4e-11, and expected values are written in degrees.
const M = (6_371_000 * Math.PI) / 180;
const meters = (degrees: number) => degrees * M;

// 0.002 degrees wide (222.39 m) by 0.001 high (111.19 m).
const RECT: BoundingBox = { min_longitude: 0, max_longitude: 0.002, min_latitude: 0, max_latitude: 0.001 };
const RADIUS = 10;
/** A point `dx`, `dy` meters east and north of (lon, lat) degrees. */
const near = (lon: number, lat: number, dx: number, dy: number): [number, number] => [lon + dx / M, lat + dy / M];

function expectBox(actual: BoundingBox, expected: BoundingBox) {
  expect(actual.min_longitude).toBeCloseTo(expected.min_longitude, 7);
  expect(actual.max_longitude).toBeCloseTo(expected.max_longitude, 7);
  expect(actual.min_latitude).toBeCloseTo(expected.min_latitude, 7);
  expect(actual.max_latitude).toBeCloseTo(expected.max_latitude, 7);
}

describe("hitTest", () => {
  it("grabs the body from the middle", () => {
    expect(hitTest(RECT, [0.001, 0.0005], RADIUS)).toBe("move");
  });

  it("grabs each corner", () => {
    expect(hitTest(RECT, [0, 0], RADIUS)).toBe("sw");
    expect(hitTest(RECT, [0.002, 0], RADIUS)).toBe("se");
    expect(hitTest(RECT, [0.002, 0.001], RADIUS)).toBe("ne");
    expect(hitTest(RECT, [0, 0.001], RADIUS)).toBe("nw");
  });

  it("grabs each edge away from the corners", () => {
    expect(hitTest(RECT, [0.001, 0.001], RADIUS)).toBe("n");
    expect(hitTest(RECT, [0.001, 0], RADIUS)).toBe("s");
    expect(hitTest(RECT, [0.002, 0.0005], RADIUS)).toBe("e");
    expect(hitTest(RECT, [0, 0.0005], RADIUS)).toBe("w");
  });

  it("grabs an edge from just outside it, within the radius", () => {
    expect(hitTest(RECT, near(0.001, 0.001, 0, 8), RADIUS)).toBe("n");
  });

  it("prefers a corner to an edge within reach of both", () => {
    // 6 m east of the north-west corner along the north edge: on the edge, and 6 m from the corner.
    expect(hitTest(RECT, near(0, 0.001, 6, 0), RADIUS)).toBe("nw");
  });

  it("prefers an edge to the inside within reach of both", () => {
    // 5 m inside the north edge, far from the corners.
    expect(hitTest(RECT, near(0.001, 0.001, 0, -5), RADIUS)).toBe("n");
  });

  it("is the body further in than the radius, and nothing outside it", () => {
    expect(hitTest(RECT, near(0.001, 0.001, 0, -30), RADIUS)).toBe("move");
    expect(hitTest(RECT, near(0.001, 0.001, 0, 30), RADIUS)).toBeNull();
    expect(hitTest(RECT, near(0.002, 0.0005, 30, 0), RADIUS)).toBeNull();
  });

  it("is not fooled by latitude: a degree of longitude is shorter at 60 degrees", () => {
    // Centre at 60 N: 0.002 degrees of longitude is 0.002 * M * 0.5 = 111.19 m wide.
    const high: BoundingBox = { min_longitude: 0, max_longitude: 0.002, min_latitude: 59.9995, max_latitude: 60.0005 };
    // 50 m east of the centre is inside (half width 55.6 m); 70 m east is outside the east edge by 14.4 m, beyond 10 m.
    const lonPerMeter = 1 / (M * 0.5);
    expect(hitTest(high, [0.001 + 50 * lonPerMeter, 60], RADIUS)).toBe("e");
    expect(hitTest(high, [0.001 + 70 * lonPerMeter, 60], RADIUS)).toBeNull();
  });
});

describe("applyDrag", () => {
  it("moves without changing the size", () => {
    const moved = applyDrag(RECT, "move", { dx: meters(0.001), dy: meters(-0.0002) });
    expectBox(moved, { min_longitude: 0.001, max_longitude: 0.003, min_latitude: -0.0002, max_latitude: 0.0008 });
  });

  it("moves one side for each edge", () => {
    expectBox(applyDrag(RECT, "e", { dx: meters(0.001), dy: meters(0.5) }), { ...RECT, max_longitude: 0.003 });
    expectBox(applyDrag(RECT, "w", { dx: meters(0.0005), dy: meters(0.5) }), { ...RECT, min_longitude: 0.0005 });
    expectBox(applyDrag(RECT, "n", { dx: meters(0.5), dy: meters(0.0005) }), { ...RECT, max_latitude: 0.0015 });
    expectBox(applyDrag(RECT, "s", { dx: meters(0.5), dy: meters(-0.0005) }), { ...RECT, min_latitude: -0.0005 });
  });

  it("moves two sides for each corner", () => {
    expectBox(applyDrag(RECT, "ne", { dx: meters(0.001), dy: meters(0.0005) }), { ...RECT, max_longitude: 0.003, max_latitude: 0.0015 });
    expectBox(applyDrag(RECT, "sw", { dx: meters(-0.0005), dy: meters(-0.0005) }), { ...RECT, min_longitude: -0.0005, min_latitude: -0.0005 });
    expectBox(applyDrag(RECT, "nw", { dx: meters(0.0005), dy: meters(0.0003) }), { ...RECT, min_longitude: 0.0005, max_latitude: 0.0013 });
    expectBox(applyDrag(RECT, "se", { dx: meters(-0.0005), dy: meters(-0.0002) }), { ...RECT, max_longitude: 0.0015, min_latitude: -0.0002 });
  });

  it("flips cleanly when a side is dragged past its opposite", () => {
    // East edge from 0.002 to -0.001: the box now spans -0.001 to 0 (the west side stayed at 0).
    expectBox(applyDrag(RECT, "e", { dx: meters(-0.003), dy: 0 }), { ...RECT, min_longitude: -0.001, max_longitude: 0 });
    // South edge from 0 to 0.003 over the north side at 0.001: spans 0.001 to 0.003.
    const flipped = applyDrag(RECT, "s", { dx: 0, dy: meters(0.003) });
    expect(flipped.min_latitude).toBeCloseTo(0.001, 7);
    expect(flipped.max_latitude).toBeCloseTo(0.003, 7);
    expect(flipped.min_latitude).toBeLessThan(flipped.max_latitude);
  });

  it("never shrinks a side below the minimum, on whichever side of the opposite edge it lands", () => {
    const minDegrees = MIN_SIZE_METERS / M;
    // East edge 5 m east of the west side: kept at 10 m wide.
    const near1 = applyDrag(RECT, "e", { dx: -(meters(0.002) - 5), dy: 0 });
    expectBox(near1, { ...RECT, max_longitude: minDegrees });
    // East edge 5 m west of the west side: flipped, and 10 m wide.
    const near2 = applyDrag(RECT, "e", { dx: -(meters(0.002) + 5), dy: 0 });
    expectBox(near2, { ...RECT, min_longitude: -minDegrees, max_longitude: 0 });
    // The north side stays fixed and the other axis is untouched by an edge drag.
    expect(near2.max_latitude).toBeCloseTo(0.001, 7);
  });

  it("applies the minimum to both axes of a corner", () => {
    const minDegrees = MIN_SIZE_METERS / M;
    const shrunk = applyDrag(RECT, "ne", { dx: -meters(0.0019), dy: -meters(0.00095) });
    // The south-west corner is fixed at 0, 0: 0.0001 deg is 11.1 m, 0.00005 deg is 5.6 m -> raised to 10 m.
    expect(shrunk.max_longitude).toBeCloseTo(0.0001, 7);
    expect(shrunk.max_latitude).toBeCloseTo(minDegrees, 7);
  });
});

describe("describeSize", () => {
  it("measures width, height and area, under the limit", () => {
    const size = describeSize(RECT);
    expect(size.widthMeters).toBeCloseTo(222.39, 1);
    expect(size.heightMeters).toBeCloseTo(111.19, 1);
    expect(size.areaKm2).toBeCloseTo(0.0247, 3);
    expect(size.overLimit).toBe(false);
  });

  it("flags a rectangle over 1 km²", () => {
    // 0.01 degrees square is 1111.95 m a side: 1.236 km².
    const size = describeSize({ min_longitude: 0, max_longitude: 0.01, min_latitude: 0, max_latitude: 0.01 });
    expect(size.areaKm2).toBeCloseTo(1.236, 2);
    expect(size.overLimit).toBe(true);
  });
});

describe("sizeLabel", () => {
  it("shows size and area, and the limit only when it is exceeded", () => {
    expect(sizeLabel(RECT)).toBe("222 × 111 m · 0.025 km²");
    const big = sizeLabel({ min_longitude: 0, max_longitude: 0.01, min_latitude: 0, max_latitude: 0.01 });
    expect(big).toBe("1112 × 1112 m · 1.24 km² · over the 1 km² limit");
  });
});

describe("metersPerPixel", () => {
  it("is the equator circumference over 512 px at zoom 0, halving per zoom level and at 60 degrees", () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
    expect(metersPerPixel(0, 1)).toBeCloseTo(39135.758, 2);
    expect(metersPerPixel(60, 0)).toBeCloseTo(39135.758, 2);
  });
});

describe("cursorFor", () => {
  it("names what each part does", () => {
    expect(cursorFor("move")).toBe("move");
    expect(cursorFor("n")).toBe("ns-resize");
    expect(cursorFor("s")).toBe("ns-resize");
    expect(cursorFor("e")).toBe("ew-resize");
    expect(cursorFor("w")).toBe("ew-resize");
    expect(cursorFor("ne")).toBe("nesw-resize");
    expect(cursorFor("sw")).toBe("nesw-resize");
    expect(cursorFor("nw")).toBe("nwse-resize");
    expect(cursorFor("se")).toBe("nwse-resize");
    expect(cursorFor(null)).toBe("");
  });
});
