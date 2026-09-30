import { describe, expect, it } from "vitest";
import type { BoundingBox } from "../api/types";
import { areaSquareMeters, bboxFromCorners, bboxProblem, bboxRing, formatSquareKilometers, roundBbox, sameBbox } from "./bbox";

// [s, w, n, e, area m² as the server computes it, does the server accept it], computed with
// server/app/domain/bounding_box.py, so the client's 1 km² rule can't drift from the server's.
const SERVER_VECTORS: [number, number, number, number, number, boolean][] = [
  [52.5285, 13.3995, 52.531, 13.4035, 75220.358196, true],
  [9.933, -84.081, 9.935, -84.079, 48715.889577, true],
  [52.52, 13.4, 52.529, 13.4148, 1002129.069672, false],
  [52.52, 13.4, 52.529, 13.4146, 988586.784993, true],
  [-33.87, 151.2, -33.861, 151.2108, 997868.809282, true],
  [64.14, -21.95, 64.149, -21.93, 970737.699761, true],
];

const box = (s: number, w: number, n: number, e: number): BoundingBox => ({ min_latitude: s, min_longitude: w, max_latitude: n, max_longitude: e });

describe("the 1 km² rule matches the server", () => {
  it.each(SERVER_VECTORS)("%f,%f,%f,%f", (s, w, n, e, area, accepted) => {
    expect(areaSquareMeters(box(s, w, n, e))).toBeCloseTo(area, 3);
    expect(bboxProblem(box(s, w, n, e)) === null).toBe(accepted);
  });
});

describe("bboxProblem", () => {
  it("flags an empty or inverted box", () => {
    expect(bboxProblem(box(52.53, 13.4, 52.53, 13.41))).toBe("empty");
  });
  it("flags coordinates out of range", () => {
    expect(bboxProblem(box(89.9, 13.4, 90.1, 13.41))).toBe("out_of_range");
  });
  it("flags a box over 1 km²", () => {
    expect(bboxProblem(box(52.52, 13.4, 52.529, 13.4148))).toBe("too_large");
  });
});

describe("bboxFromCorners", () => {
  it("normalizes corners dragged in any direction", () => {
    expect(bboxFromCorners([13.41, 52.52], [13.4, 52.53])).toEqual(box(52.52, 13.4, 52.53, 13.41));
  });
});

describe("helpers", () => {
  it("rounds to 7 decimals so the same drawn box is the same area", () => {
    expect(roundBbox(box(52.123456789, 13.1, 52.2, 13.2)).min_latitude).toBe(52.1234568);
    expect(sameBbox(roundBbox(box(52.123456789, 13.1, 52.2, 13.2)), box(52.1234568, 13.1, 52.2, 13.2))).toBe(true);
  });
  it("closes the ring counter-clockwise from the south-west", () => {
    expect(bboxRing(box(1, 2, 3, 4))).toEqual([[2, 1], [4, 1], [4, 3], [2, 3], [2, 1]]);
  });
  it("formats km²", () => {
    expect(formatSquareKilometers(75220)).toBe("0.075 km²");
    expect(formatSquareKilometers(988586)).toBe("0.99 km²");
  });
});
