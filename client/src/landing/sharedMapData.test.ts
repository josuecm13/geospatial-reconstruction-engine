import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { MapData } from "../api/types";
import { shareMapData } from "./sharedMapData";

const fake = (impl: () => Promise<MapData>) => {
  const mapData = vi.fn(impl);
  return { api: { mapData, listImportAreas: vi.fn() } as unknown as ApiClient, mapData };
};

const CLIP = { mode: "clip" } as const;

describe("shareMapData", () => {
  it("fetches the shared area once, in clip mode", async () => {
    const { api, mapData } = fake(() => Promise.resolve({} as MapData));
    const shared = shareMapData(api);
    shared.share("a");
    await shared.api.mapData("a", CLIP);
    expect(mapData).toHaveBeenCalledWith("a", { mode: "clip" });
  });

  it("asks once for the shared area, however many callers", async () => {
    const data = { attribution: "x" } as MapData;
    const { api, mapData } = fake(() => Promise.resolve(data));
    const shared = shareMapData(api);
    shared.share("a");
    expect(await Promise.all([shared.api.mapData("a", CLIP), shared.api.mapData("a", CLIP), shared.api.mapData("a", CLIP)])).toEqual([data, data, data]);
    expect(mapData).toHaveBeenCalledTimes(1);
  });

  it("passes other areas and scoped queries through", async () => {
    const { api, mapData } = fake(() => Promise.resolve({} as MapData));
    const shared = shareMapData(api);
    shared.share("a");
    await shared.api.mapData("b", CLIP);
    await shared.api.mapData("b", CLIP);
    await shared.api.mapData("a", { boundaryId: "z", mode: "clip" });
    await shared.api.mapData("a");
    expect(mapData).toHaveBeenCalledTimes(4);
  });

  it("asks again after a failure", async () => {
    let calls = 0;
    const { api } = fake(() => (++calls === 1 ? Promise.reject(new Error("down")) : Promise.resolve({} as MapData)));
    const shared = shareMapData(api);
    shared.share("a");
    await expect(shared.api.mapData("a", CLIP)).rejects.toThrow("down");
    await Promise.resolve();
    await expect(shared.api.mapData("a", CLIP)).resolves.toEqual({});
    expect(calls).toBe(2);
  });
});
