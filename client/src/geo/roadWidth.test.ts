import { describe, expect, it } from "vitest";
import { metersPerPixel, roadWidthExpression } from "./roadWidth";

describe("metersPerPixel", () => {
  it("is about 78 km/px at zoom 0 on the equator with 512 px tiles", () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78_271.5, 0);
  });
  it("halves per zoom level and shrinks with latitude", () => {
    expect(metersPerPixel(16, 0)).toBeCloseTo(metersPerPixel(15, 0) / 2, 9);
    expect(metersPerPixel(16, 60)).toBeCloseTo(metersPerPixel(16, 0) / 2, 9);
  });
});

describe("roadWidthExpression", () => {
  it("divides the road's width by the ground resolution at each stop", () => {
    const expression = roadWidthExpression(52.53) as [string, unknown, unknown, number, unknown[], number, unknown[]];
    expect(expression.slice(0, 3)).toEqual(["interpolate", ["exponential", 2], ["zoom"]]);
    const [, , , z1, stop1, z2] = expression;
    expect([z1, z2]).toEqual([10, 24]);
    expect(stop1).toEqual(["max", 1, ["/", ["get", "width_meters"], metersPerPixel(10, 52.53)]]);
  });
});
