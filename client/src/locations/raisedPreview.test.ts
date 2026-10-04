import { describe, expect, it } from "vitest";
import {
  MAX_TILT,
  centroidY,
  easeOut,
  groundScale,
  raiseBuilding,
  raisePoint,
  sortFarToNear,
  tiltAngle,
  type FlatBuilding,
  type Point,
  type RaiseView,
} from "./raisedPreview";

const view = (t: number): RaiseView => ({ t, pivotY: 200, pxPerMetre: 2 });
const square = (x: number, y: number, size: number): Point[] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

describe("tiltAngle and easeOut", () => {
  it.each([
    [-1, 0],
    [0, 0],
    [1, MAX_TILT],
    [2, MAX_TILT],
  ])("tiltAngle(%s)", (t, expected) => {
    expect(tiltAngle(t)).toBeCloseTo(expected, 10);
  });

  it.each([
    [0, 0],
    [1, 1],
    [-1, 0],
    [3, 1],
  ])("easeOut(%s) = %s", (p, expected) => {
    expect(easeOut(p)).toBeCloseTo(expected, 10);
  });

  it("eases out: more than half done at the halfway mark", () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe("groundScale", () => {
  it.each([
    [0, 1],
    [1, Math.cos(MAX_TILT)],
  ])("groundScale(%s)", (t, expected) => {
    expect(groundScale(t)).toBeCloseTo(expected, 10);
  });
});

describe("raisePoint", () => {
  it("is the identity on the ground at t = 0, whatever the height is not", () => {
    expect(raisePoint(view(0), [30, 70])).toEqual([30, 70]);
  });

  it("does not lift at t = 0, even for a tall point", () => {
    expect(raisePoint(view(0), [30, 70], 50)).toEqual([30, 70]);
  });

  it("keeps the pivot row fixed on the ground", () => {
    expect(raisePoint(view(1), [30, 200])[1]).toBeCloseTo(200, 10);
  });

  it("foreshortens distance from the pivot by cos(max tilt)", () => {
    expect(raisePoint(view(1), [0, 300])[1]).toBeCloseTo(200 + 100 * Math.cos(MAX_TILT), 10);
    expect(raisePoint(view(1), [0, 100])[1]).toBeCloseTo(200 - 100 * Math.cos(MAX_TILT), 10);
  });

  it("lifts by height * pxPerMetre * sin(angle) up the screen", () => {
    const [, ground] = raisePoint(view(1), [0, 300]);
    const [x, roof] = raisePoint(view(1), [12, 300], 10);
    expect(x).toBe(12);
    expect(ground - roof).toBeCloseTo(10 * 2 * Math.sin(MAX_TILT), 10);
  });
});

describe("sortFarToNear", () => {
  it("puts the footprint nearest the top of the picture first", () => {
    const near: FlatBuilding = { ring: square(10, 300, 20), height: 5 };
    const far: FlatBuilding = { ring: square(10, 20, 20), height: 5 };
    const mid: FlatBuilding = { ring: square(10, 150, 20), height: 5 };
    expect(sortFarToNear([near, far, mid])).toEqual([far, mid, near]);
  });

  it("does not mutate its input", () => {
    const a: FlatBuilding = { ring: square(0, 100, 10), height: 1 };
    const b: FlatBuilding = { ring: square(0, 0, 10), height: 1 };
    const input = [a, b];
    sortFarToNear(input);
    expect(input).toEqual([a, b]);
  });

  it("ignores the repeated closing vertex when finding the centroid", () => {
    expect(centroidY(square(0, 0, 10))).toBe(5);
  });
});

describe("raiseBuilding", () => {
  const flat: FlatBuilding = { ring: square(100, 250, 40), height: 10 };

  it("draws a roof equal to the footprint at t = 0", () => {
    expect(raiseBuilding(view(0), flat).roof).toEqual(square(100, 250, 40).slice(0, 4));
  });

  it("has one wall: the south (near) edge of a square, whichever way the ring winds", () => {
    for (const ring of [square(100, 250, 40), [...square(100, 250, 40)].reverse()]) {
      const { walls } = raiseBuilding(view(1), { ring, height: 10 });
      expect(walls).toHaveLength(1);
      const southY = raisePoint(view(1), [0, 290])[1];
      expect(walls[0][0][1]).toBeCloseTo(southY, 10);
      expect(walls[0][1][1]).toBeCloseTo(southY, 10);
    }
  });

  it("builds the wall from the base up to the roof edge", () => {
    const { walls, roof } = raiseBuilding(view(1), flat);
    const [a, b, bTop, aTop] = walls[0];
    expect(bTop[1]).toBeLessThan(b[1]);
    expect(aTop[1]).toBeLessThan(a[1]);
    expect(roof).toContainEqual(aTop);
    expect(roof).toContainEqual(bTop);
  });

  it("lifts the roof above the footprint's ground position, by the height", () => {
    const ground = raisePoint(view(1), [100, 250]);
    const roofPoint = raiseBuilding(view(1), flat).roof[0];
    expect(ground[1] - roofPoint[1]).toBeCloseTo(10 * 2 * Math.sin(MAX_TILT), 10);
  });

  it("returns nothing for a degenerate ring", () => {
    expect(raiseBuilding(view(1), { ring: [[0, 0], [1, 1]], height: 5 })).toEqual({ walls: [], roof: [] });
  });
});
