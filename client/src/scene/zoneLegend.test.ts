// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { COLORS } from "./palette";
import { createZoneLegend } from "./zoneLegend";

function setup() {
  const container = document.createElement("div");
  const legend = createZoneLegend(container);
  const root = container.querySelector(".zone-legend") as HTMLElement;
  return { legend, root, items: () => [...root.querySelectorAll("li")].map((li) => li.textContent) };
}

describe("createZoneLegend", () => {
  it("is hidden until it is visible and has reasons to list", () => {
    const { legend, root } = setup();

    expect(root.hidden).toBe(true);
    legend.setVisible(true);
    expect(root.hidden).toBe(true); // nothing to list
    legend.setReasons(["water"]);
    expect(root.hidden).toBe(false);
    legend.setVisible(false);
    expect(root.hidden).toBe(true);
  });

  it("lists only the reasons present, in a fixed order, each with its zone's colour", () => {
    const { legend, root, items } = setup();
    legend.setVisible(true);

    legend.setReasons(["setback", "water", "setback"]);

    expect(items()).toEqual(["Near water", "Front setback"]);
    const swatches = [...root.querySelectorAll<HTMLElement>(".zone-swatch")];
    const probe = document.createElement("span");
    probe.style.background = COLORS.zoneWater;
    expect(swatches[0].style.background).toBe(probe.style.background);
    expect(swatches[0].style.background).not.toBe(swatches[1].style.background);
  });

  it("empties when the world has no zones", () => {
    const { legend, root, items } = setup();
    legend.setVisible(true);
    legend.setReasons(["steep"]);

    legend.setReasons([]);

    expect(items()).toEqual([]);
    expect(root.hidden).toBe(true);
  });
});
