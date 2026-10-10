import { describe, expect, it } from "vitest";
import { buildFootprintIndex } from "./collision";
import { createTargetEase, easeInOut, easeTarget, nearestOpenPoint, pinOnTerrain, walkStart } from "./pinPoint";
import { flatTerrain, type Terrain } from "./terrain";

const square = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];
const index = buildFootprintIndex([{ id: "b", ring: square }]);
const slope: Terrain = { ...flatTerrain(), hasGround: true, heightAtLocal: (x) => x * 0.1 };

describe("easing", () => {
  it("runs from 0 to 1, flat at the ends, and clamps", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });

  it("interpolates a target", () => {
    expect(easeTarget({ x: 0, y: 0, z: 0 }, { x: 10, y: 4, z: -2 }, 0.5)).toEqual({ x: 5, y: 2, z: -1 });
  });

  it("takes the duration to arrive, then goes idle", () => {
    const ease = createTargetEase(() => false, 400);
    expect(ease.step(16)).toBeNull();
    ease.start({ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
    const mid = ease.step(200)!;
    expect(mid.x).toBeCloseTo(4);
    expect(ease.step(200)).toEqual({ x: 8, y: 0, z: 0 });
    expect(ease.step(16)).toBeNull();
  });

  it("lands on the destination at once under reduced motion", () => {
    const ease = createTargetEase(() => true, 400);
    ease.start({ x: 0, y: 0, z: 0 }, { x: 8, y: 1, z: 2 });
    expect(ease.step(0)).toEqual({ x: 8, y: 1, z: 2 });
    expect(ease.step(16)).toBeNull();
  });
});

describe("pinOnTerrain", () => {
  it("sits at the terrain height, and at 0 without terrain", () => {
    expect(pinOnTerrain(slope, 50, 3)).toEqual({ x: 50, y: 5, z: 3 });
    expect(pinOnTerrain(undefined, 50, 3).y).toBe(0);
    expect(pinOnTerrain(flatTerrain(), 50, 3).y).toBe(0);
  });
});

describe("walkStart", () => {
  const eye = (x: number) => 1.7 + x * 0.1;

  it("starts at the pin at eye height, facing the camera's horizontal direction", () => {
    const start = walkStart({ x: 20, z: 5 }, { x: 0, y: -0.7, z: 2 }, index, eye);
    expect(start.position.x).toBe(20);
    expect(start.position.z).toBe(5);
    expect(start.position.y).toBeCloseTo(3.7);
    expect(start.lookAt.x).toBeCloseTo(20);
    expect(start.lookAt.z).toBeCloseTo(6);
    expect(start.lookAt.y).toBeCloseTo(3.7);
  });

  it("faces north when the camera looks straight down", () => {
    expect(walkStart({ x: 20, z: 5 }, { x: 0, y: -1, z: 0 }, index, eye).lookAt.z).toBeCloseTo(4);
  });

  it("moves a pin inside a footprint to open ground nearby", () => {
    const start = walkStart({ x: 9, z: 5 }, { x: 1, y: 0, z: 0 }, index, eye);
    expect(start.position.x).toBeGreaterThan(10);
    expect(start.position.x).toBeLessThan(13);
    expect(Math.abs(start.position.z - 5)).toBeLessThan(3);
    const open = { x: start.position.x, z: start.position.z };
    expect(nearestOpenPoint(index, open)).toEqual(open);
  });

  it("works with no footprints", () => {
    expect(walkStart({ x: 1, z: 1 }, { x: 1, y: 0, z: 0 }, undefined, eye).position.x).toBe(1);
  });
});
