import { describe, expect, it } from "vitest";
import { pointInBox } from "./spotlight";

describe("pointInBox", () => {
  it("is the pointer's offset from the box's top-left corner", () => {
    expect(pointInBox({ left: 100, top: 40 }, 130, 90)).toEqual({ x: 30, y: 50 });
  });

  it("is zero at the corner and negative outside the box", () => {
    expect(pointInBox({ left: 10, top: 10 }, 10, 10)).toEqual({ x: 0, y: 0 });
    expect(pointInBox({ left: 10, top: 10 }, 4, 2)).toEqual({ x: -6, y: -8 });
  });

  it("keeps fractional pixels", () => {
    expect(pointInBox({ left: 0.5, top: 0.25 }, 10, 10)).toEqual({ x: 9.5, y: 9.75 });
  });
});
