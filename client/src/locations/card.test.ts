// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ImportArea } from "../api/types";
import { renderLocationCard } from "./card";
import { toCard } from "./cardModel";
import { consumeFlyTo } from "./flyTo";
import type { PreviewLoader } from "./preview";

const bbox = { min_latitude: 52.52, min_longitude: 13.39, max_latitude: 52.54, max_longitude: 13.41 };
const area = (over: Partial<ImportArea> = {}): ImportArea => ({
  id: "abc", provider: "osm", bbox, status: "completed", road_count: 1, node_count: 1, building_count: 1, poi_count: 0,
  area_feature_count: 0, block_count: 1, linked_building_count: null, imported_at: "2026-10-02T11:00:00Z", ...over,
});
const previews = { attach: () => {} } as unknown as PreviewLoader;
const render = (over: Partial<ImportArea> = {}, onOpen?: () => void) =>
  renderLocationCard(toCard(area(over), new Date("2026-10-02T12:00:00Z")), { previews, onOpen });

describe("renderLocationCard links", () => {
  it("gives a completed card its map link and an Open in 3D link to the scene", () => {
    const card = render();

    expect(card.querySelector<HTMLAnchorElement>("a.location-open")!.getAttribute("href")).toBe("/explore/abc");
    const scene = card.querySelector<HTMLAnchorElement>("a.location-open-3d")!;
    expect(scene.textContent).toBe("Open in 3D");
    expect(scene.getAttribute("href")).toBe("/explore/abc?view=scene");
    expect(scene.hasAttribute("data-link")).toBe(true);
  });

  it("does not mark a fly-to when opened in 3D, and leaves the click undefaulted", () => {
    const onOpen = vi.fn();
    const scene = render({}, onOpen).querySelector<HTMLAnchorElement>("a.location-open-3d")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    scene.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
    expect(consumeFlyTo("abc")).toBe(false);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it.each(["pending", "importing", "failed"] as const)("has neither link on a %s card", (status) => {
    const card = render({ status, imported_at: null });

    expect(card.querySelector("a")).toBeNull();
  });
});

describe("renderLocationCard place name", () => {
  it("titles by place name with a context line and the coordinates in the meta", () => {
    const card = render({ place_name: "Mitte", place_context: "Berlin, Germany" });

    expect(card.querySelector(".location-open")!.textContent).toBe("Mitte");
    expect(card.querySelector(".location-context")!.textContent).toBe("Berlin, Germany");
    expect(card.querySelector(".location-meta .location-coords")!.textContent).toBe("52.5300° N, 13.4000° E");
  });
});
