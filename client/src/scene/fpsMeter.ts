export interface FrameStats {
  fps: number;
  meanMs: number;
  p95Ms: number;
}

export interface FpsMeter {
  record(deltaMs: number): void;
  stats(): FrameStats;
}

/** A rolling frame-time meter over the last `capacity` frames (120 by default). */
export function createFpsMeter(capacity = 120): FpsMeter {
  const frames: number[] = [];
  return {
    record(deltaMs) {
      frames.push(deltaMs);
      if (frames.length > capacity) frames.shift();
    },
    stats() {
      if (!frames.length) return { fps: 0, meanMs: 0, p95Ms: 0 };
      const meanMs = frames.reduce((sum, ms) => sum + ms, 0) / frames.length;
      const sorted = [...frames].sort((a, b) => a - b);
      const p95Ms = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
      return { fps: meanMs > 0 ? 1000 / meanMs : 0, meanMs, p95Ms };
    },
  };
}
