import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFramingPolicy, overview, rectangleOverview } from "./framing";

describe("createFramingPolicy", () => {
  it("frames when no staged build is pending, even after the user moved", () => {
    const policy = createFramingPolicy();
    policy.userMoved();
    expect(policy.shouldFrame()).toBe(true);
  });

  it("frames after an untouched staged build", () => {
    const policy = createFramingPolicy();
    policy.stagedStarted();
    expect(policy.shouldFrame()).toBe(true);
  });

  it("keeps the camera after a staged build the user moved in, once", () => {
    const policy = createFramingPolicy();
    policy.stagedStarted();
    policy.userMoved();
    expect(policy.shouldFrame()).toBe(false);
    expect(policy.shouldFrame()).toBe(true);
  });

  it("frames after an abandoned build", () => {
    const policy = createFramingPolicy();
    policy.stagedStarted();
    policy.userMoved();
    policy.reset();
    expect(policy.shouldFrame()).toBe(true);
  });

  it("ignores a move made before the build started", () => {
    const policy = createFramingPolicy();
    policy.userMoved();
    policy.stagedStarted();
    expect(policy.shouldFrame()).toBe(true);
  });
});

describe("overview", () => {
  it("frames a 100 x 100 m box at the origin as setWorld always has", () => {
    const box = new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 0, 50));
    const size = Math.hypot(100, 100);
    const view = overview(box);
    expect(view.target.toArray()).toEqual([0, 0, 0]);
    expect(view.position.y).toBeCloseTo(0.6 * size);
    expect(view.position.z).toBeCloseTo(0.7 * size);
    expect(view.position.x).toBeCloseTo(0);
    expect(view.far).toBeGreaterThanOrEqual(5000);
  });

  it("frames a rectangle the same way as the equivalent box", () => {
    const view = rectangleOverview(100, 100);
    expect(view.position.y).toBeCloseTo(0.6 * Math.hypot(100, 100));
    expect(view.target.toArray()).toEqual([0, 0, 0]);
  });
});
