import { describe, expect, it } from "vitest";
import { layout } from "./architecture";

describe("layout", () => {
  it("puts the six stages on one line", () => {
    const { positions, width, height } = layout(6);
    // x = 12 + column * (176 + 36); y = 12
    expect(positions[0]).toEqual({ x: 12, y: 12 });
    expect(positions[5]).toEqual({ x: 1072, y: 12 });
    expect(new Set(positions.map((p) => p.y)).size).toBe(1);
    expect(width).toBe(24 + 6 * 176 + 5 * 36);
    expect(height).toBe(24 + 52);
  });

  it("wraps into two rows of three for a tablet", () => {
    const { positions, width, height } = layout(3);
    // y = 12 + row * (52 + 44)
    expect(positions[2]).toEqual({ x: 436, y: 12 });
    expect(positions[3]).toEqual({ x: 12, y: 108 });
    expect(width).toBe(24 + 3 * 176 + 2 * 36);
    expect(height).toBe(24 + 2 * 52 + 44);
  });

  it("stacks the stages in one column for a phone", () => {
    const { positions, width, height } = layout(1);
    expect(positions.map((p) => p.x)).toEqual([12, 12, 12, 12, 12, 12]);
    expect(positions[5].y).toBe(12 + 5 * 96);
    expect(width).toBe(200);
    expect(height).toBe(24 + 6 * 52 + 5 * 44);
  });
});
