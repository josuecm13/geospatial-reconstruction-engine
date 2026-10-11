import { describe, expect, it } from "vitest";
import { createFpsMeter } from "./fpsMeter";

describe("fps meter", () => {
  it("reads zeros before any frame", () => {
    expect(createFpsMeter().stats()).toEqual({ fps: 0, meanMs: 0, p95Ms: 0 });
  });

  it("reads about 60 fps from a steady 16.7 ms", () => {
    const meter = createFpsMeter();
    for (let i = 0; i < 200; i++) meter.record(16.7);
    const { fps, p95Ms } = meter.stats();
    expect(fps).toBeCloseTo(60, 0);
    expect(p95Ms).toBeCloseTo(16.7, 5);
  });

  it("pushes p95 up with a few long frames", () => {
    const meter = createFpsMeter();
    for (let i = 0; i < 110; i++) meter.record(16.7);
    for (let i = 0; i < 10; i++) meter.record(80);
    expect(meter.stats().p95Ms).toBe(80);
  });

  it("keeps only the last 120 frames", () => {
    const meter = createFpsMeter();
    for (let i = 0; i < 120; i++) meter.record(100);
    for (let i = 0; i < 120; i++) meter.record(10);
    expect(meter.stats().meanMs).toBeCloseTo(10, 5);
  });
});
