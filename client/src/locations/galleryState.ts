import type { SortKey } from "./cardModel";

/** What the gallery keeps in the browser's history entry, so Back returns to the same spot. */
export interface GalleryState {
  scroll: number;
  text: string;
  sort: SortKey;
}

export const DEFAULT_GALLERY_STATE: GalleryState = { scroll: 0, text: "", sort: "recent" };
const KEY = "locations";

/** The gallery's saved state in a history entry's state, with anything missing or malformed replaced by its default. */
export function readGalleryState(historyState: unknown): GalleryState {
  const saved = (historyState as Record<string, unknown> | null)?.[KEY] as Partial<Record<keyof GalleryState, unknown>> | undefined;
  if (!saved || typeof saved !== "object") return { ...DEFAULT_GALLERY_STATE };
  return {
    scroll: typeof saved.scroll === "number" && Number.isFinite(saved.scroll) && saved.scroll > 0 ? saved.scroll : 0,
    text: typeof saved.text === "string" ? saved.text : "",
    sort: saved.sort === "size" || saved.sort === "name" ? saved.sort : "recent",
  };
}

/** `historyState` with the gallery's state set, keeping whatever else is in there. */
export function withGalleryState(historyState: unknown, gallery: GalleryState): Record<string, unknown> {
  const rest = historyState && typeof historyState === "object" ? (historyState as Record<string, unknown>) : {};
  return { ...rest, [KEY]: { ...gallery } };
}
