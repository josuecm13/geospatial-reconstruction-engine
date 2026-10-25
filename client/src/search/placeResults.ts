import type { PlaceResult } from "../api/types";

/** How many places a search asks for. */
export const SEARCH_LIMIT = 5;
/** The shortest query worth sending; the server refuses anything shorter once trimmed. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 200;
/** Picking a place never zooms in past here, so a small place (a point) still shows its surroundings. */
export const MAX_PLACE_ZOOM = 16;
/** Pixels kept around the place's box. */
export const PLACE_PADDING = 48;

export interface PlaceLine {
  title: string;
  /** The rest of the display name after the title, or empty. */
  subtitle: string;
  /** What kind of place it is ("Administrative", "Residential"), or empty. */
  kind: string;
}

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** Two lines for a result: its short name, and where it is. Nominatim's `display_name` starts with the name. */
export function describePlace(place: PlaceResult): PlaceLine {
  const parts = place.display_name.split(",").map((part) => part.trim()).filter(Boolean);
  const title = place.name.trim() || parts[0] || place.display_name;
  const rest = parts[0] === title ? parts.slice(1) : parts;
  const type = place.type && place.type !== "yes" ? place.type : place.category;
  return { title, subtitle: rest.join(", "), kind: type ? capitalize(type.replace(/_/g, " ")) : "" };
}

/** The query as it will be sent, or null when it is too short or too long to search for. */
export function normalizeQuery(raw: string): string | null {
  const query = raw.trim();
  return query.length >= MIN_QUERY_LENGTH && query.length <= MAX_QUERY_LENGTH ? query : null;
}

/** The corners MapLibre's `fitBounds` takes: south-west then north-east, as [longitude, latitude]. */
export function placeBounds(place: PlaceResult): [[number, number], [number, number]] {
  return [
    [place.bbox.west, place.bbox.south],
    [place.bbox.east, place.bbox.north],
  ];
}

export type ListAction = { type: "move"; active: number } | { type: "choose"; index: number } | { type: "close" } | null;

/**
 * What a key does to a results list of `count` entries whose `active` one is highlighted (-1: none).
 * Arrows wrap; Enter chooses the highlighted entry (and is left to the form when none is); Escape closes.
 */
export function keyAction(key: string, active: number, count: number): ListAction {
  if (key === "Escape") return { type: "close" };
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return { type: "move", active: active < 0 || active >= count - 1 ? 0 : active + 1 };
    case "ArrowUp":
      return { type: "move", active: active <= 0 ? count - 1 : active - 1 };
    case "Home":
      return { type: "move", active: 0 };
    case "End":
      return { type: "move", active: count - 1 };
    case "Enter":
      return active >= 0 && active < count ? { type: "choose", index: active } : null;
    default:
      return null;
  }
}
