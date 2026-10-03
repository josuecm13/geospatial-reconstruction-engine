import { describe, expect, it } from "vitest";
import type { MapData } from "../api/types";
import type { Selection } from "../state/selection";
import { SceneLoader } from "./sceneLoader";

const fakeData = (id: string) => ({ scope: { type: "import_area", id } }) as unknown as MapData;

function setup() {
  const pending: { areaId: string; query: unknown; resolve: (d: MapData) => void; reject: (e: unknown) => void }[] = [];
  const api = {
    mapData: (areaId: string, query: unknown) => new Promise<MapData>((resolve, reject) => pending.push({ areaId, query, resolve, reject })),
  };
  let selection: Selection = { areaId: "a1", scope: { type: "import_area" } };
  const listeners: ((s: Selection) => void)[] = [];
  const source = { get: () => selection, subscribe: (l: (s: Selection) => void) => (listeners.push(l), () => undefined) };
  const calls: string[] = [];
  const target = {
    setWorld: (d: MapData) => calls.push(`world:${d.scope.id}`),
    showMessage: (m: string) => calls.push(`message:${m}`),
    clear: () => calls.push("clear"),
  };
  const loader = new SceneLoader(api, source, target, () => "failed");
  const select = (next: Selection) => {
    selection = next;
    listeners.forEach((l) => l(next));
  };
  return { pending, calls, loader, select };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SceneLoader", () => {
  it("does nothing while the scene is hidden", () => {
    const { pending, select } = setup();
    select({ areaId: "a2", scope: { type: "import_area" } });
    expect(pending).toHaveLength(0);
  });

  it("loads the selection when shown, passing the boundary scope", async () => {
    const { pending, calls, loader, select } = setup();
    select({ areaId: "a1", scope: { type: "boundary", boundaryId: "b9" } });
    loader.shown();
    expect(pending[0]).toMatchObject({ areaId: "a1", query: { boundaryId: "b9" } });
    pending[0].resolve(fakeData("a1"));
    await flush();
    expect(calls).toEqual(["world:a1"]);
  });

  it("drops a response that is no longer the latest", async () => {
    const { pending, calls, loader, select } = setup();
    loader.shown();
    select({ areaId: "a2", scope: { type: "import_area" } });
    pending[1].resolve(fakeData("a2"));
    await flush();
    pending[0].resolve(fakeData("a1")); // arrives late
    await flush();
    expect(calls).toEqual(["world:a2"]);
  });

  it("shows the hint when no area is open, and a message on error", async () => {
    const { pending, calls, loader, select } = setup();
    select({ areaId: null, scope: { type: "import_area" } });
    loader.shown();
    expect(calls).toEqual(["clear"]);
    select({ areaId: "a1", scope: { type: "import_area" } });
    pending[0].reject(new Error("boom"));
    await flush();
    expect(calls).toEqual(["clear", "message:failed"]);
  });

  it("does not reload an already shown selection", async () => {
    const { pending, loader } = setup();
    loader.shown();
    pending[0].resolve(fakeData("a1"));
    await flush();
    loader.hidden();
    loader.shown();
    expect(pending).toHaveLength(1);
  });
});
