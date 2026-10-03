import type { ImportArea } from "../api/types";
import type { Route } from "../routing/routes";

/**
 * Where "Import a new place" goes. The explore page is always about one area (its URL names it), so
 * the import panel is reached through an area: the one open last in this browser, else the most
 * recent one listed. With neither there is no area to open, and the locations page is the way on.
 */
export function importTarget(areas: readonly ImportArea[], rememberedAreaId: string | null): Route {
  const areaId = rememberedAreaId ?? areas[0]?.id ?? null;
  if (!areaId) return { page: "locations" };
  return { page: "explore", areaId, view: "map", scope: null, at: null };
}
