import { describe, expect, it } from "vitest";
import { defaultOpen, layoutFor, toggled } from "./panelLayout";

describe("layoutFor", () => {
  it("switches at 900 and 720 px", () => {
    expect(layoutFor(1440)).toBe("overlay");
    expect(layoutFor(900)).toBe("overlay");
    expect(layoutFor(899)).toBe("side");
    expect(layoutFor(720)).toBe("side");
    expect(layoutFor(719)).toBe("sheet");
    expect(layoutFor(320)).toBe("sheet");
  });
});

describe("defaultOpen and toggled", () => {
  it("opens beside the map and peeks as a sheet", () => {
    expect(defaultOpen("overlay")).toBe(true);
    expect(defaultOpen("side")).toBe(true);
    expect(defaultOpen("sheet")).toBe(false);
  });

  it("flips for a side panel and a sheet, never closes the overlay", () => {
    expect(toggled("side", true)).toBe(false);
    expect(toggled("sheet", false)).toBe(true);
    expect(toggled("overlay", false)).toBe(true);
  });
});
