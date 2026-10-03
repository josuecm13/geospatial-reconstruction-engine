import { describe, expect, it } from "vitest";
import { consumeFlyTo, distanceMeters, fitZoom, flyDurationMs, flyParams, FLY_CURVE, markFlyTo } from "./flyTo";

const viewport = { width: 632, height: 632 }; // with the default 60 px padding, 512 px of room each way
// 45 degrees wide: 1/8 of the world, 64 px at zoom 0, so 512 px of room is exactly zoom 3. 2 degrees tall is far smaller.
const wide = { min_latitude: -1, min_longitude: 0, max_latitude: 1, max_longitude: 45 };

describe("flyDurationMs", () => {
  it("is 1.2 s for a hop and grows 0.6 s per tenfold distance", () => {
    expect(flyDurationMs(0)).toBe(1200);
    expect(flyDurationMs(-5)).toBe(1200);
    expect(flyDurationMs(9_000)).toBeCloseTo(1800, 8); // log10(1 + 9) = 1
    expect(flyDurationMs(99_000)).toBeCloseTo(2400, 8); // log10(1 + 99) = 2
  });

  it("never takes more than 3.5 s", () => {
    expect(flyDurationMs(1e9)).toBe(3500);
  });
});

describe("fitZoom", () => {
  it("fits the limiting side: 1/8 of the world across 512 px is zoom 3", () => {
    expect(fitZoom(wide, viewport)).toBeCloseTo(3, 8);
  });

  it("fits the height when that is what limits, one zoom level per halving of the room", () => {
    const tall = { min_latitude: 0, min_longitude: 0, max_latitude: 0.1, max_longitude: 0.001 };

    expect(fitZoom(tall, { width: 632, height: 632 }) - fitZoom(tall, { width: 632, height: 332 })).toBeCloseTo(Math.log2(512 / 212), 8);
  });

  it("stops at zoom 19 for a sliver, and at 0 for the whole world", () => {
    expect(fitZoom({ min_latitude: 0, min_longitude: 0, max_latitude: 1e-6, max_longitude: 1e-6 }, viewport)).toBe(19);
    expect(fitZoom({ min_latitude: 5, min_longitude: 5, max_latitude: 5, max_longitude: 5 }, viewport)).toBe(19);
    expect(fitZoom({ min_latitude: -80, min_longitude: -180, max_latitude: 80, max_longitude: 180 }, { width: 300, height: 300 })).toBe(0);
  });

  it("copes with a map that has no size yet", () => {
    expect(fitZoom(wide, { width: 0, height: 0 })).toBe(0);
  });
});

describe("distanceMeters", () => {
  it("is a degree of arc on the equator times the earth radius", () => {
    expect(distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo((6_371_000 * Math.PI) / 180, 3);
    expect(distanceMeters({ lat: 3, lon: 4 }, { lat: 3, lon: 4 })).toBe(0);
  });
});

describe("flyParams", () => {
  it("centres on the rectangle and fits it", () => {
    const params = flyParams({ lat: 40, lon: -3, zoom: 12 }, wide, viewport);

    expect(params.center[0]).toBeCloseTo(22.5, 8);
    expect(params.center[1]).toBeCloseTo(0, 8); // symmetric about the equator
    expect(params.zoom).toBeCloseTo(3, 8);
    expect(params.curve).toBe(FLY_CURVE);
    expect(FLY_CURVE).toBe(1.42);
  });

  it("is the shortest fly when the map is already there", () => {
    expect(flyParams({ lat: 0, lon: 22.5, zoom: 3 }, wide, viewport).duration).toBe(1200);
  });

  it("scales the duration with a ten kilometer jump", () => {
    const from = { lat: 0, lon: 0, zoom: 10 };
    const to = { min_latitude: -0.01, min_longitude: 0.08, max_latitude: 0.01, max_longitude: 0.1 };
    // 0.09 degrees of longitude on the equator is 10 007.5 m: 1200 + 600 * log10(11.0075) = 1825 ms
    expect(flyParams(from, to, viewport).duration).toBeCloseTo(1825, -1);
  });

  it("takes the longest fly across the world", () => {
    const berlin = { min_latitude: 52.52, min_longitude: 13.39, max_latitude: 52.54, max_longitude: 13.41 };

    expect(flyParams({ lat: -33.87, lon: 151.21, zoom: 15 }, berlin, viewport).duration).toBe(3500);
  });

  it("fits a tiny rectangle at the zoom limit", () => {
    const tiny = { min_latitude: 1, min_longitude: 1, max_latitude: 1.000001, max_longitude: 1.000001 };

    expect(flyParams({ lat: 1, lon: 1, zoom: 5 }, tiny, viewport).zoom).toBe(19);
  });
});

describe("the fly mark", () => {
  it("is used up by the area it names", () => {
    markFlyTo("a", 1000);

    expect(consumeFlyTo("a", 1500)).toBe(true);
    expect(consumeFlyTo("a", 1500)).toBe(false);
  });

  it("does not apply to another area, and is gone afterwards", () => {
    markFlyTo("a", 1000);

    expect(consumeFlyTo("b", 1000)).toBe(false);
    expect(consumeFlyTo("a", 1000)).toBe(false);
  });

  it("expires after five seconds", () => {
    markFlyTo("a", 0);
    expect(consumeFlyTo("a", 5001)).toBe(false);

    markFlyTo("a", 0);
    expect(consumeFlyTo("a", 5000)).toBe(true);
  });

  it("is false when nothing was marked", () => {
    expect(consumeFlyTo("a", 0)).toBe(false);
  });
});
