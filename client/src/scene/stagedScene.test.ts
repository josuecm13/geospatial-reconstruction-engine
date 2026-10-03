import { describe, expect, it } from "vitest";
import { bboxMeters } from "./stagedScene";

describe("bboxMeters", () => {
  it("measures a rectangle on the equator: 0.001 degree is pi * 6371000 / 180 / 1000 = 111.19 m each way", () => {
    const { width, height } = bboxMeters({ min_latitude: -0.0005, min_longitude: 0, max_latitude: 0.0005, max_longitude: 0.001 });
    expect(width).toBeCloseTo(111.19, 1);
    expect(height).toBeCloseTo(111.19, 1);
  });

  it("narrows the width with latitude: at 60 degrees a degree of longitude is half as long", () => {
    const { width, height } = bboxMeters({ min_latitude: 59.9995, min_longitude: 10, max_latitude: 60.0005, max_longitude: 10.001 });
    expect(width).toBeCloseTo(55.6, 1); // 111.19 * cos(60 degrees)
    expect(height).toBeCloseTo(111.19, 1);
  });
});
