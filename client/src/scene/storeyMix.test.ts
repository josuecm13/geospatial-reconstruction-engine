import { describe, expect, it } from "vitest";
import { TWO_STOREY_SHARE_DEFAULT, drawStoreys, fnv1aUnit, storeyShares } from "./storeyMix";

const at = (block_id: string | null, levels: number | null) => ({ block_id, levels });

describe("storeyShares", () => {
  it("uses a block's own share once it has three buildings stating 1 or 2 levels", () => {
    const shares = storeyShares([at("a", 2), at("a", 1), at("a", 1), at("a", 1), at("b", 2), at("b", 2), at("b", 2)]);
    expect(shares.forBlock("a")).toBe(0.25);
    expect(shares.forBlock("b")).toBe(1);
  });

  it("falls back to the area when the block has too little evidence, or no block", () => {
    // Five buildings state 1 or 2 levels, two of them 2; levels 5 and null say nothing.
    const shares = storeyShares([at("a", 2), at("a", 1), at("b", 1), at("b", 1), at(null, 2), at("c", 5), at("c", null)]);
    expect(shares.forBlock("a")).toBeCloseTo(2 / 5);
    expect(shares.forBlock(null)).toBeCloseTo(2 / 5);
    expect(shares.forBlock("zz")).toBeCloseTo(2 / 5);
  });

  it("falls back to the default when the area has too little evidence too", () => {
    expect(storeyShares([at("a", 2), at("a", 1), at("a", 4)]).forBlock("a")).toBe(TWO_STOREY_SHARE_DEFAULT);
    expect(storeyShares([]).forBlock(null)).toBe(0.3);
  });
});

describe("drawStoreys", () => {
  it("is pinned to the same FNV-1a values as the server", () => {
    // `server/tests/domain/test_generation.py` pins the same two values.
    expect(fnv1aUnit("a") * 2 ** 32).toBe(3826002220);
    expect(fnv1aUnit("way/123") * 2 ** 32).toBe(3327974463);
    expect(drawStoreys("way/123", 0.78)).toBe(2);
    expect(drawStoreys("way/123", 0.77)).toBe(1);
  });

  it("is deterministic and matches the share over many ids", () => {
    const draw = (id: number) => drawStoreys(`b${id}`, 0.3);
    expect(draw(5)).toBe(draw(5));
    const share = Array.from({ length: 1000 }, (_, i) => draw(i)).filter((n) => n === 2).length / 1000;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.35);
  });
});
