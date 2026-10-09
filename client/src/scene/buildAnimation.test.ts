import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Animator, easeOutCubic, progress, riseDuration, staggerDelay } from "./buildAnimation";

const box = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ opacity: 0.5, vertexColors: true }));

describe("animation timing", () => {
  it("eases out and clamps", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875); // 1 - 0.5^3
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
  });

  it("measures progress from a delay", () => {
    expect(progress(0.5, 0.2, 0.6)).toBeCloseTo(0.5);
    expect(progress(0.1, 0.2, 0.6)).toBe(0);
    expect(progress(5, 0.2, 0.6)).toBe(1);
  });

  it("staggers 20 ms apart, squeezed so a big ring stays under 1.5 s", () => {
    expect(staggerDelay(3, 10)).toBeCloseTo(0.06); // 3 * min(0.02, 0.15)
    expect(staggerDelay(10, 150)).toBeCloseTo(0.1); // 10 * min(0.02, 1.5 / 150 = 0.01)
    expect(riseDuration(1)).toBeCloseTo(0.8);
    expect(riseDuration(10)).toBeCloseTo(0.98); // 0.8 + 9 * 0.02
    expect(riseDuration(300)).toBeCloseTo(2.295); // 0.8 + 299 * min(0.02, 0.005)
  });
});

describe("Animator", () => {
  it("raises a building from nothing and finishes at full height", async () => {
    const animator = new Animator();
    const mesh = box();
    const done = animator.rise([mesh]);
    expect(mesh.scale.y).toBe(0);
    expect(mesh.visible).toBe(false);
    animator.update(0.5); // 0.5 / 0.8 = 0.625 through: 1 - 0.375^3
    expect(mesh.scale.y).toBeCloseTo(0.947265625);
    expect(mesh.visible).toBe(true);
    animator.update(0.4); // 0.9 s elapsed, past the 0.8 s duration
    await done;
    expect(mesh.scale.y).toBe(1);
  });

  it("fades on a cloned material and gives the shared one back", async () => {
    const animator = new Animator();
    const mesh = box();
    const original = mesh.material as THREE.Material;
    const done = animator.fadeIn([mesh]);
    const clone = mesh.material as THREE.Material;
    expect(clone).not.toBe(original);
    expect(clone.opacity).toBe(0);
    expect(clone.vertexColors).toBe(true); // the baked shade survives the clone
    animator.update(0.3); // halfway through 0.6 s: eased 0.875, of the material's own 0.5
    expect(clone.opacity).toBeCloseTo(0.4375);
    expect(original.opacity).toBe(0.5);
    animator.update(0.4);
    await done;
    expect(mesh.material).toBe(original);
  });

  it("skip finishes what is pending and makes later steps instant", async () => {
    const animator = new Animator();
    const first = box();
    const pending = animator.rise([first]);
    animator.skip();
    await pending;
    expect(first.scale.y).toBe(1);
    const second = box();
    await animator.rise([second]);
    expect(second.scale.y).toBe(1); // untouched: no animation was started
    expect(animator.skipping).toBe(true);
    animator.reset();
    expect(animator.skipping).toBe(false);
  });
});
