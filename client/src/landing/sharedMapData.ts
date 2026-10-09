import type { ApiClient } from "../api/client";
import type { MapData } from "../api/types";

/**
 * The landing page reads the featured place's map-data in three places (the 2D preview, the 3D stage and the capability
 * visuals). `api` is the client they all get: for the shared area's whole-area map-data it answers every caller from one
 * request, and everything else passes straight through. A failed request is forgotten, so a later caller asks again.
 */
export function shareMapData(api: ApiClient): { api: ApiClient; share(areaId: string): void } {
  const wrapped = Object.create(api) as ApiClient;
  let shared: { id: string; data: Promise<MapData> } | null = null;
  let sharedId: string | null = null;

  wrapped.mapData = (id, query) => {
    const whole = !query || (!query.boundaryId && !query.mode);
    if (id !== sharedId || !whole) return api.mapData(id, query);
    if (shared?.id !== id) {
      const data = api.mapData(id);
      shared = { id, data };
      data.catch(() => {
        if (shared?.data === data) shared = null;
      });
    }
    return shared.data;
  };
  return {
    api: wrapped,
    share: (areaId) => {
      sharedId = areaId;
    },
  };
}
