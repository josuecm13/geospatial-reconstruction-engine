import type { MapDataQuery } from "../api/client";
import { CurrentArea } from "../importing/recentImports";

/** What the rest of the client shows: the whole import area, or one of its traced boundaries. */
export type Scope = { type: "import_area" } | { type: "boundary"; boundaryId: string };

export interface Selection {
  areaId: string | null;
  scope: Scope;
}

/** The scope chosen for an area, so a reload comes back to it. Stored with its area's id, so it
 * never applies to a different area. */
export const SCOPE_KEY = "gre.scope";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;
type Listener = (selection: Selection) => void;

const WHOLE_AREA: Scope = { type: "import_area" };

/**
 * The open area and its scope, shared by every view (map layers, boundaries, 3D scene, routing).
 * Views subscribe instead of reaching into each other. Opening another area resets the scope to
 * the whole area.
 */
export class SelectionStore {
  private readonly current: CurrentArea;
  private readonly listeners = new Set<Listener>();
  private selection: Selection;

  constructor(private readonly store: KeyValueStore) {
    this.current = new CurrentArea(store);
    const areaId = this.current.id;
    this.selection = { areaId, scope: areaId ? this.storedScope(areaId) : WHOLE_AREA };
  }

  get(): Selection {
    return this.selection;
  }

  setArea(areaId: string): void {
    if (areaId === this.selection.areaId) return;
    this.current.id = areaId;
    this.update({ areaId, scope: WHOLE_AREA });
  }

  /** No area open (the map before a first import). The remembered area stays remembered for next time. */
  closeArea(): void {
    if (this.selection.areaId === null) return;
    this.update({ areaId: null, scope: WHOLE_AREA });
  }

  setScope(scope: Scope): void {
    if (!this.selection.areaId || sameScope(scope, this.selection.scope)) return;
    this.update({ ...this.selection, scope });
  }

  /** Calls `listener` on every change (not immediately); returns the unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(selection: Selection): void {
    this.selection = selection;
    if (selection.areaId) this.store.setItem(SCOPE_KEY, JSON.stringify({ areaId: selection.areaId, scope: selection.scope }));
    for (const listener of this.listeners) listener(selection);
  }

  private storedScope(areaId: string): Scope {
    try {
      const stored = JSON.parse(this.store.getItem(SCOPE_KEY) ?? "null");
      if (stored?.areaId === areaId && stored.scope?.type === "boundary" && typeof stored.scope.boundaryId === "string") {
        return { type: "boundary", boundaryId: stored.scope.boundaryId };
      }
    } catch {
      // A corrupt entry is the same as none.
    }
    return WHOLE_AREA;
  }
}

export function sameScope(a: Scope, b: Scope): boolean {
  return a.type === b.type && (a.type === "import_area" || a.boundaryId === (b as { boundaryId: string }).boundaryId);
}

/** The `map-data` query for a scope. */
export function mapDataQuery(scope: Scope): MapDataQuery {
  return scope.type === "boundary" ? { boundaryId: scope.boundaryId } : {};
}
