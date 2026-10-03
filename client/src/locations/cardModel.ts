import type { BoundingBox, ImportArea, ImportStatus } from "../api/types";
import { areaSquareMeters, formatSquareKilometers } from "../geo/bbox";

export type SortKey = "recent" | "size";

export interface CardCount {
  key: "buildings" | "roads" | "blocks";
  label: string;
  value: number;
}

/** What one card in the gallery shows, derived from an import area; everything the view needs is a plain value here. */
export interface LocationCard {
  id: string;
  /** The rounded centre, as the API gives places no name. */
  title: string;
  /** The size of the rectangle, e.g. "0.250 km²". */
  subtitle: string;
  /** When it was imported, in words ("3 d ago", "12 Mar 2026"), or "Never completed". */
  when: string;
  /** The raw timestamp: part of what a cached preview is keyed by, and what "recent" sorts on. */
  importedAt: string | null;
  /** Empty unless the import completed. */
  counts: CardCount[];
  status: ImportStatus;
  statusLabel: string;
  bbox: BoundingBox;
  squareMeters: number;
}

const STATUS_LABELS: Record<ImportStatus, string> = {
  pending: "Waiting to import",
  importing: "Importing",
  completed: "Imported",
  failed: "Import failed",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The centre of the rectangle to four decimals (about 10 m), with hemispheres: "52.5300° N, 13.4000° E". */
export function formatCentre(bbox: BoundingBox): string {
  const lat = (bbox.min_latitude + bbox.max_latitude) / 2;
  const lon = (bbox.min_longitude + bbox.max_longitude) / 2;
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
}

/** How long ago `iso` was, in words; a week or more ago is a date (UTC, so it reads the same everywhere). */
export function formatWhen(iso: string | null, now: Date): string {
  if (!iso) return "Never completed";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Never completed";
  const age = now.getTime() - then.getTime();
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)} d ago`;
  return `${then.getUTCDate()} ${MONTHS[then.getUTCMonth()]} ${then.getUTCFullYear()}`;
}

export function toCard(area: ImportArea, now: Date = new Date()): LocationCard {
  const squareMeters = areaSquareMeters(area.bbox);
  const completed = area.status === "completed";
  return {
    id: area.id,
    title: formatCentre(area.bbox),
    subtitle: formatSquareKilometers(squareMeters),
    when: formatWhen(area.imported_at, now),
    importedAt: area.imported_at,
    counts: completed
      ? [
          { key: "buildings", label: "buildings", value: area.building_count ?? 0 },
          { key: "roads", label: "roads", value: area.road_count ?? 0 },
          { key: "blocks", label: "blocks", value: area.block_count },
        ]
      : [],
    status: area.status,
    statusLabel: STATUS_LABELS[area.status],
    bbox: area.bbox,
    squareMeters,
  };
}

/** Cards matching every word of `text` (case-insensitive) in the place, size, date, or status; blank text matches all. */
export function filterCards(cards: readonly LocationCard[], text: string): LocationCard[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...cards];
  return cards.filter((card) => {
    const haystack = `${card.title} ${card.subtitle} ${card.when} ${card.statusLabel}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** A sorted copy: "recent" puts the latest import first (areas never completed last), "size" the largest rectangle first. Ties keep a stable order by id. */
export function sortCards(cards: readonly LocationCard[], key: SortKey): LocationCard[] {
  const time = (card: LocationCard) => (card.importedAt ? Date.parse(card.importedAt) : Number.NEGATIVE_INFINITY);
  const primary = (a: LocationCard, b: LocationCard): number => {
    if (key === "size") return b.squareMeters - a.squareMeters;
    const [ta, tb] = [time(a), time(b)];
    return ta === tb ? 0 : tb > ta ? 1 : -1;
  };
  return [...cards].sort((a, b) => primary(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
