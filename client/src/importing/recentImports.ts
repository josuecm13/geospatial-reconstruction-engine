import type { BoundingBox, ImportArea } from "../api/types";
import { sameBbox } from "../geo/bbox";

/** Areas imported from this browser, newest first, so they can be reopened after a reload. The
 * API has no "list import areas" endpoint, so this is the client's own memory. */
export interface RecentImport {
  id: string;
  bbox: BoundingBox;
  importedAt: string | null;
  buildingCount: number | null;
  roadCount: number | null;
}

export const RECENT_IMPORTS_KEY = "gre.recentImports";
export const CURRENT_AREA_KEY = "gre.currentArea";
export const MAX_RECENT = 12;

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export class RecentImports {
  constructor(private readonly store: KeyValueStore) {}

  list(): RecentImport[] {
    try {
      const parsed = JSON.parse(this.store.getItem(RECENT_IMPORTS_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Records an import; re-importing the same area moves it to the front instead of duplicating it. */
  record(area: ImportArea): RecentImport[] {
    const entry: RecentImport = {
      id: area.id,
      bbox: area.bbox,
      importedAt: area.imported_at,
      buildingCount: area.building_count,
      roadCount: area.road_count,
    };
    const next = [entry, ...this.list().filter((item) => item.id !== area.id)].slice(0, MAX_RECENT);
    this.store.setItem(RECENT_IMPORTS_KEY, JSON.stringify(next));
    return next;
  }

  /** The earlier import of exactly this rectangle, if any: importing it again reconciles, and may delete. */
  findByBbox(bbox: BoundingBox): RecentImport | undefined {
    return this.list().find((item) => sameBbox(item.bbox, bbox));
  }

  get current(): string | null {
    return this.store.getItem(CURRENT_AREA_KEY);
  }

  set current(id: string | null) {
    if (id) this.store.setItem(CURRENT_AREA_KEY, id);
  }
}
