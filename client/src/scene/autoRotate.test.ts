import { describe, expect, it } from "vitest";
import { createAutoRotate, IDLE_SECONDS } from "./autoRotate";

const flying = { fly: true, world: true, building: false };

describe("createAutoRotate", () => {
  it("never rotates when disabled", () => {
    const rotate = createAutoRotate(false);
    for (let i = 0; i < 20; i++) expect(rotate.update(1, flying)).toBe(false);
  });

  it("rotates on the first frame when enabled, flying, with a world", () => {
    expect(createAutoRotate(true).update(0.016, flying)).toBe(true);
  });

  it("does not rotate without a world", () => {
    expect(createAutoRotate(true).update(0.016, { ...flying, world: false })).toBe(false);
  });

  it("holds still during an interaction, however long", () => {
    const rotate = createAutoRotate(true);
    rotate.interactionStart();
    for (let i = 0; i < 30; i++) expect(rotate.update(1, flying)).toBe(false);
  });

  it("waits IDLE_SECONDS after an interaction ends", () => {
    const rotate = createAutoRotate(true);
    rotate.interactionStart();
    rotate.interactionEnd();
    for (let i = 0; i < IDLE_SECONDS - 1; i++) expect(rotate.update(1, flying)).toBe(false);
    expect(rotate.update(1, flying)).toBe(true);
  });

  it("waits again after leaving walk mode", () => {
    const rotate = createAutoRotate(true);
    expect(rotate.update(1, { ...flying, fly: false })).toBe(false);
    expect(rotate.update(IDLE_SECONDS - 1, flying)).toBe(false);
    expect(rotate.update(1, flying)).toBe(true);
  });

  it("does not rotate during a build, and waits after it ends", () => {
    const rotate = createAutoRotate(true);
    expect(rotate.update(10, { ...flying, building: true })).toBe(false);
    expect(rotate.update(IDLE_SECONDS - 1, flying)).toBe(false);
    expect(rotate.update(1, flying)).toBe(true);
  });

  it("stops at once when disabled, and idle time does not bring it back", () => {
    const rotate = createAutoRotate(true);
    rotate.setEnabled(false);
    expect(rotate.update(1, flying)).toBe(false);
    expect(rotate.update(IDLE_SECONDS * 2, flying)).toBe(false);
  });

  it("rotates at once when enabled, even right after an interaction", () => {
    const rotate = createAutoRotate(false);
    rotate.interactionEnd();
    rotate.setEnabled(true);
    expect(rotate.update(0.016, flying)).toBe(true);
  });
});
