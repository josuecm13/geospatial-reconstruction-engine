import type { ImportArea } from "../api/types";
import type { Route } from "../routing/routes";

/**
 * Where "Import a new place" goes: the map, with the area open last in this browser, else the most
 * recent one listed, so a new rectangle is drawn near a known place. With neither, the map with nothing
 * open (`/explore`), where a first import starts.
 */
export function importTarget(areas: readonly ImportArea[], rememberedAreaId: string | null): Route {
  const areaId = rememberedAreaId ?? areas[0]?.id ?? null;
  return { page: "explore", areaId, view: "map", scope: null, at: null };
}
