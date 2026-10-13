import { describe, expect, it } from "vitest";
import { createPixelRatioController, GOOD_WINDOWS, initialPixelRatio, MAX_PIXEL_RATIO, STALL_MS, STEP, WINDOW_MS } from "./pixelRatio";

/** Feeds frames of `ms` for one whole window and returns the ratio after it. */
const run = (controller: ReturnType<typeof createPixelRatioController>, ms: number) => {
  let ratio = controller.ratio();
  for (let t = 0; t < WINDOW_MS; t += ms) ratio = controller.frame(ms);
  return ratio;
};

describe("initialPixelRatio", () => {
  it("is the device's ratio, capped", () => {
    expect(initialPixelRatio(3)).toBe(MAX_PIXEL_RATIO);
    expect(initialPixelRatio(1)).toBe(1);
    expect(initialPixelRatio(0)).toBe(1);
  });
});

describe("createPixelRatioController", () => {
  it("starts at the cap and holds while frames are healthy", () => {
    const controller = createPixelRatioController(1.5);
    expect(run(controller, 16)).toBe(1.5);
    expect(run(controller, 28)).toBe(1.5); // between the thresholds: no change
  });

  it("steps down one step per slow window, never below 1", () => {
    const controller = createPixelRatioController(1.5);
    expect(run(controller, 40)).toBe(1.5 - STEP);
    expect(run(controller, 40)).toBe(1);
    expect(run(controller, 40)).toBe(1);
  });

  it("judges the p95, not the mean: a few spikes in a window do not drop it", () => {
    const controller = createPixelRatioController(1.5);
    for (let i = 0; i < 100; i++) controller.frame(16); // 1.6 s
    for (let i = 0; i < 3; i++) controller.frame(100); // 0.3 s of spikes
    for (let i = 0; i < 7; i++) controller.frame(16); // the window closes: 110 frames, 3 of them slow
    expect(controller.ratio()).toBe(1.5);
  });

  it("ignores stalls (a hidden tab)", () => {
    const controller = createPixelRatioController(1.5);
    for (let i = 0; i < 20; i++) controller.frame(STALL_MS + 1);
    expect(controller.ratio()).toBe(1.5);
  });

  it("rises only after several fast windows in a row", () => {
    const controller = createPixelRatioController(1.5);
    run(controller, 40);
    for (let i = 0; i < GOOD_WINDOWS - 1; i++) expect(run(controller, 12)).toBe(1.25);
    expect(run(controller, 12)).toBe(1.5);
  });

  it("a middling window resets the run of fast ones", () => {
    const controller = createPixelRatioController(1.5);
    run(controller, 40);
    run(controller, 12);
    run(controller, 12);
    run(controller, 28);
    run(controller, 12);
    run(controller, 12);
    expect(controller.ratio()).toBe(1.25);
    expect(run(controller, 12)).toBe(1.5);
  });

  it("waits twice as long to rise again after a rise is followed at once by a drop", () => {
    const controller = createPixelRatioController(1.5);
    run(controller, 40);
    for (let i = 0; i < GOOD_WINDOWS; i++) run(controller, 12); // back to 1.5
    expect(run(controller, 40)).toBe(1.25); // too slow again
    for (let i = 0; i < 2 * GOOD_WINDOWS - 1; i++) expect(run(controller, 12)).toBe(1.25);
    expect(run(controller, 12)).toBe(1.5);
  });

  it("never changes when the cap is 1", () => {
    const controller = createPixelRatioController(1);
    expect(run(controller, 60)).toBe(1);
    expect(run(controller, 10)).toBe(1);
  });
});
