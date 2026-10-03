import { describe, expect, it } from "vitest";
import { CURRENT_AREA_KEY } from "../importing/recentImports";
import { mapDataQuery, SCOPE_KEY, type Selection, SelectionStore } from "./selection";

class MemoryStore {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe("SelectionStore", () => {
  it("starts on the whole area of the last opened area", () => {
    const memory = new MemoryStore();
    memory.setItem(CURRENT_AREA_KEY, "a1");

    expect(new SelectionStore(memory).get()).toEqual({ areaId: "a1", scope: { type: "import_area" } });
  });

  it("closes the area without forgetting it, and notifies once", () => {
    const memory = new MemoryStore();
    memory.setItem(CURRENT_AREA_KEY, "a1");
    const store = new SelectionStore(memory);
    const seen: Selection[] = [];
    store.subscribe((selection) => seen.push(selection));

    store.closeArea();
    store.closeArea();

    expect(store.get()).toEqual({ areaId: null, scope: { type: "import_area" } });
    expect(seen).toEqual([{ areaId: null, scope: { type: "import_area" } }]);
    expect(memory.getItem(CURRENT_AREA_KEY)).toBe("a1");
  });

  it("restores a boundary scope after a reload, but only for the area it was chosen in", () => {
    const memory = new MemoryStore();
    const first = new SelectionStore(memory);
    first.setArea("a1");
    first.setScope({ type: "boundary", boundaryId: "b1" });

    expect(new SelectionStore(memory).get().scope).toEqual({ type: "boundary", boundaryId: "b1" });

    memory.setItem(CURRENT_AREA_KEY, "a2");
    expect(new SelectionStore(memory).get().scope).toEqual({ type: "import_area" });
  });

  it("resets the scope when another area opens, and notifies subscribers of each change", () => {
    const store = new SelectionStore(new MemoryStore());
    const seen: Selection[] = [];
    store.subscribe((selection) => seen.push(selection));

    store.setArea("a1");
    store.setScope({ type: "boundary", boundaryId: "b1" });
    store.setScope({ type: "boundary", boundaryId: "b1" });
    store.setArea("a2");

    expect(seen).toEqual([
      { areaId: "a1", scope: { type: "import_area" } },
      { areaId: "a1", scope: { type: "boundary", boundaryId: "b1" } },
      { areaId: "a2", scope: { type: "import_area" } },
    ]);
  });

  it("ignores a scope while no area is open, and a corrupt stored scope", () => {
    const memory = new MemoryStore();
    const store = new SelectionStore(memory);
    store.setScope({ type: "boundary", boundaryId: "b1" });
    expect(store.get()).toEqual({ areaId: null, scope: { type: "import_area" } });

    memory.setItem(CURRENT_AREA_KEY, "a1");
    memory.setItem(SCOPE_KEY, "{not json");
    expect(new SelectionStore(memory).get().scope).toEqual({ type: "import_area" });
  });
});

describe("mapDataQuery", () => {
  it("asks for a boundary only when one is the scope", () => {
    expect(mapDataQuery({ type: "import_area" })).toEqual({});
    expect(mapDataQuery({ type: "boundary", boundaryId: "b1" })).toEqual({ boundaryId: "b1" });
  });
});
