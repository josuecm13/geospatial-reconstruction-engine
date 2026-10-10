/** The pure parts of the landing page's capability visuals: which route to ask for, how to label it, and the street's heights. No DOM. */
import type { Coordinate, MapData, Position } from "../api/types";
import { buildingHeight } from "../scene/buildingHeight";

const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;

/** Metres between two [lon, lat] points, on a flat local projection (good to well under 1% across a square kilometre). */
export function groundDistance(a: Position, b: Position): number {
  const cosLat = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * cosLat, a[1] - b[1]) * METERS_PER_DEGREE;
}

/** Up to `limit` items spread evenly over `items`, in order. */
export function evenSample<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  return Array.from({ length: limit }, (_, i) => items[Math.floor((i * items.length) / limit)]);
}

/**
 * Pairs of road nodes, farthest apart first, from an even sample of the area's nodes. The first pair gives the longest route
 * the sample can show; the rest are for when the server finds no way between the first (a disconnected piece of the network).
 */
export function farthestPairs(nodes: readonly Position[], count = 3, sample = 60): [Coordinate, Coordinate][] {
  const picked = evenSample(nodes, sample);
  const pairs: { a: Position; b: Position; metres: number }[] = [];
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) pairs.push({ a: picked[i], b: picked[j], metres: groundDistance(picked[i], picked[j]) });
  }
  pairs.sort((x, y) => y.metres - x.metres);
  const asCoordinate = ([longitude, latitude]: Position): Coordinate => ({ latitude, longitude });
  return pairs.slice(0, count).map(({ a, b }) => [asCoordinate(a), asCoordinate(b)]);
}

/** The positions of the area's navigable nodes. */
export function nodePositions(data: MapData): Position[] {
  return data.navigable_nodes.features.flatMap((f) => (f.geometry.type === "Point" ? [f.geometry.coordinates] : []));
}

/** `1.42 km` from 1 km up, `640 m` below. */
export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

/** The glTF file the scene exports for an area: `gre-area-<first 8 of its id>.glb`. */
export function glbName(areaId: string): string {
  return `gre-area-${areaId.replace(/-/g, "").slice(0, 8)}.glb`;
}

/** A small deterministic generator (mulberry32), so a street built from the same seed is the same every time. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number from a string, for seeding. */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface StreetBuilding {
  /** Height in metres. */
  height: number;
  /** True when the height was assumed rather than read from the data. */
  defaulted: boolean;
}

/**
 * `count` buildings for the walk-through street: the real heights of the area's buildings (drawn in a seeded
 * order, so the street is stable) when there are any, else seeded heights marked as assumed.
 */
export function streetBuildings(data: MapData | null, seed: number, count: number): StreetBuilding[] {
  const random = seeded(seed);
  const real = (data?.buildings.features ?? []).map((f) => buildingHeight(f.properties));
  return Array.from({ length: count }, () => {
    if (real.length > 0) {
      const { height, defaulted } = real[Math.floor(random() * real.length)];
      return { height: Math.min(Math.max(height, 3), 45), defaulted };
    }
    return { height: 6 + random() * 18, defaulted: true };
  });
}
