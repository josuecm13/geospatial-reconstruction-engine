import type { BoundingBox, ImportArea } from "../api/types";
import { sameBbox } from "../geo/bbox";

/** Which area was open last, so a reload reopens it. The list of areas itself comes from the API. */
export const CURRENT_AREA_KEY = "gre.currentArea";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export class CurrentArea {
  constructor(private readonly store: KeyValueStore) {}

  get id(): string | null {
    return this.store.getItem(CURRENT_AREA_KEY);
  }

  set id(value: string | null) {
    if (value) this.store.setItem(CURRENT_AREA_KEY, value);
  }
}

/** The earlier import of exactly this rectangle, if any: importing it again reconciles, and may delete. */
export function findByBbox(areas: readonly ImportArea[], bbox: BoundingBox): ImportArea | undefined {
  return areas.find((area) => sameBbox(area.bbox, bbox));
}

/** A one-line label for an area in a list: where, when, and how much. */
export function describeArea(area: ImportArea): string {
  const lat = (area.bbox.min_latitude + area.bbox.max_latitude) / 2;
  const lon = (area.bbox.min_longitude + area.bbox.max_longitude) / 2;
  const when = area.imported_at ? new Date(area.imported_at).toLocaleString() : "never completed";
  return `${lat.toFixed(4)}, ${lon.toFixed(4)} · ${when} · ${area.building_count ?? 0} buildings, ${area.road_count ?? 0} roads`;
}
