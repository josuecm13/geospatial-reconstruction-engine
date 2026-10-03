import type { MapDataQuery } from "../api/client";
import type { MapData } from "../api/types";
import { mapDataQuery, type Selection } from "../state/selection";

/** What the loader needs of the scene view and of the API, so it can be tested without WebGL. */
export interface SceneTarget {
  setWorld(data: MapData): void;
  /** Shows `message` in the empty state, with no world. */
  showMessage(message: string): void;
  /** Back to the "open an import" hint. */
  clear(): void;
}

export interface MapDataSource {
  mapData(areaId: string, query: MapDataQuery): Promise<MapData>;
}

export interface SelectionSource {
  get(): Selection;
  subscribe(listener: (selection: Selection) => void): () => void;
}

/**
 * Loads the selection's map-data into the scene while the scene is shown: when it is shown, and on
 * every selection change. A response that isn't the latest request's is dropped.
 */
export class SceneLoader {
  private visible = false;
  private latest = 0;
  private loadedKey: string | null = null;

  constructor(
    private readonly api: MapDataSource,
    selection: SelectionSource,
    private readonly target: SceneTarget,
    private readonly report: (error: unknown) => string,
  ) {
    this.selection = selection;
    selection.subscribe(() => {
      if (this.visible) void this.load();
    });
  }

  private readonly selection: SelectionSource;

  /**
   * Holds loading while a staged build is drawing the world: nothing loads, and a request already in
   * flight is dropped. `resume` loads whatever is selected then (the finished area, or the previous
   * one if the build failed), replacing what the build left.
   */
  suspend(): void {
    this.suspended = true;
    this.latest++;
  }

  resume(): void {
    this.suspended = false;
    this.loadedKey = null;
    if (this.visible) void this.load();
  }

  private suspended = false;

  shown(): void {
    this.visible = true;
    void this.load();
  }

  hidden(): void {
    this.visible = false;
  }

  async load(): Promise<void> {
    if (this.suspended) return;
    const { areaId, scope } = this.selection.get();
    const request = ++this.latest;
    if (!areaId) {
      this.loadedKey = null;
      this.target.clear();
      return;
    }
    const key = JSON.stringify([areaId, scope]);
    if (key === this.loadedKey) return; // already showing this selection
    try {
      const data = await this.api.mapData(areaId, mapDataQuery(scope));
      if (request !== this.latest) return;
      this.loadedKey = key;
      this.target.setWorld(data);
    } catch (error) {
      if (request !== this.latest) return;
      this.loadedKey = null;
      this.target.showMessage(this.report(error));
    }
  }
}
