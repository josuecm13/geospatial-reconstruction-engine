import { describe, expect, it } from "vitest";
import { layout } from "./architecture";

describe("layout", () => {
  it("wraps six stages into two rows of three", () => {
    const { positions, width, height } = layout(3);
    // x = 12 + column * (210 + 56); y = 12 + row * (64 + 44)
    expect(positions[0]).toEqual({ x: 12, y: 12 });
    expect(positions[2]).toEqual({ x: 544, y: 12 });
    expect(positions[3]).toEqual({ x: 12, y: 120 });
    expect(positions[5]).toEqual({ x: 544, y: 120 });
    expect(width).toBe(24 + 3 * 210 + 2 * 56);
    expect(height).toBe(24 + 2 * 64 + 44);
  });

  it("stacks the stages in one column for a phone", () => {
    const { positions, width, height } = layout(1);
    expect(positions.map((p) => p.x)).toEqual([12, 12, 12, 12, 12, 12]);
    expect(positions[5].y).toBe(12 + 5 * 108);
    expect(width).toBe(234);
    expect(height).toBe(24 + 6 * 64 + 5 * 44);
  });
});
