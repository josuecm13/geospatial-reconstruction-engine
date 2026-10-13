/** The most a renderer's pixel ratio is allowed to be: a retina canvas at 2 is 4x the fragments of 1, and 1.5 still reads sharp. Shared by the scene view and the landing stage. */
export const MAX_PIXEL_RATIO = 1.5;
/** The adaptive step never goes below this. */
export const MIN_PIXEL_RATIO = 1;
/** How long a window of frames is before its p95 is judged. */
export const WINDOW_MS = 2000;
/** A p95 above this (about 30 fps) steps the ratio down... */
export const SLOW_P95_MS = 33;
/** ...and one at or below this (comfortably above 45 fps) counts towards stepping it back up. */
export const FAST_P95_MS = 22;
/** How much one step moves the ratio. */
export const STEP = 0.25;
/** A frame longer than this (a hidden tab, a stall) says nothing about the load, so it is left out of the window. */
export const STALL_MS = 250;
/** Windows in a row that must be fast before the ratio rises; doubles (up to MAX_GOOD_WINDOWS) each time a rise is followed at once by a drop, so it settles instead of oscillating. */
export const GOOD_WINDOWS = 3;
export const MAX_GOOD_WINDOWS = 12;

/** The ratio a renderer starts at: the device's, capped. */
export const initialPixelRatio = (devicePixelRatio: number): number => Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO);

export interface PixelRatioController {
  /** Once per frame with its time in milliseconds; returns the ratio to render at (it changes at most once per 2 s window). */
  frame(deltaMs: number): number;
  ratio(): number;
}

const p95 = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

/**
 * Pure decision logic for the adaptive pixel ratio: judges the p95 frame time of each ~2 s window. Slow (above 33 ms)
 * drops one step toward 1.0; fast (at most 22 ms) for several windows in a row raises one step toward `cap`. The gap between
 * the two thresholds and the run of good windows are the hysteresis.
 */
export function createPixelRatioController(cap: number): PixelRatioController {
  const ceiling = Math.max(cap, 1);
  const floor = Math.min(MIN_PIXEL_RATIO, ceiling);
  let ratio = ceiling;
  let frames: number[] = [];
  let elapsed = 0;
  let good = 0;
  let needed = GOOD_WINDOWS;
  let justRaised = false;
  return {
    ratio: () => ratio,
    frame(deltaMs) {
      if (deltaMs > STALL_MS || deltaMs <= 0) return ratio;
      frames.push(deltaMs);
      elapsed += deltaMs;
      if (elapsed < WINDOW_MS) return ratio;
      const slow = p95(frames);
      frames = [];
      elapsed = 0;
      if (slow > SLOW_P95_MS) {
        good = 0;
        if (ratio > floor) {
          if (justRaised) needed = Math.min(MAX_GOOD_WINDOWS, needed * 2);
          ratio = Math.max(floor, ratio - STEP);
        }
        justRaised = false;
      } else if (slow <= FAST_P95_MS && ratio < ceiling) {
        if (++good >= needed) {
          ratio = Math.min(ceiling, ratio + STEP);
          good = 0;
          justRaised = true;
        }
      } else {
        good = 0;
        justRaised = false;
      }
      return ratio;
    },
  };
}
