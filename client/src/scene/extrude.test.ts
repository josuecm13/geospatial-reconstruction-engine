import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { extrudeFootprints, flatGeometry, footprintShape } from "./extrude";

const square = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: -20 },
  { x: 0, z: -20 },
  { x: 0, z: 0 },
];

const bounds = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

describe("extrusion", () => {
  it("drops the closing point of a ring", () => {
    expect(footprintShape(square).getPoints()).toHaveLength(4);
  });

  it("extrudes a footprint into a box from y = 0 up to the height, keeping x and z", () => {
    const box = bounds(extrudeFootprints([footprintShape(square)], 7));
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(7);
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(10);
    expect(box.min.z).toBeCloseTo(-20);
    expect(box.max.z).toBeCloseTo(0);
  });

  it("is oriented the same for either ring winding", () => {
    const box = bounds(extrudeFootprints([footprintShape([...square].reverse())], 3));
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(3);
    expect(box.min.z).toBeCloseTo(-20);
  });

  it("lays flat shapes on y = 0 facing up", () => {
    const g = flatGeometry([footprintShape(square)]);
    const box = bounds(g);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(0);
    expect(g.getAttribute("normal").getY(0)).toBeCloseTo(1);
  });
});
