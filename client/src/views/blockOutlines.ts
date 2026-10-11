import type { BlockProperties, Feature, FeatureCollection, Geometry, MapData, Position, Projection } from "../api/types";
import { blockAt, insetRing, outlineKind, type OutlineKind } from "../scene/blockOutline";
import { toLocal, toLonLat } from "../scene/projection";

export interface OutlineProperties {
  /** The block's id, so the selected block's outline can be picked out by a filter. */
  id: string;
  kind: OutlineKind;
}

/** The polygons of a Polygon / MultiPolygon as rings of [lon, lat]. */
function polygonsOf(geometry: Geometry | null): Position[][][] {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/** A ring moved 1.5 m inward, in lon/lat: inset in local metres (blockOutline.ts), then back. */
export function insetLonLat(ring: Position[], projection: Projection): Position[] {
  return insetRing(ring.map((p) => toLocal(projection, p))).map((p) => toLonLat(projection, p.x, p.z));
}

/** The 2D map's block outlines: each block's boundary inset 1.5 m, as lines with the block's id and how it is drawn (crisp, reference or faint). */
export function blockOutlines(data: Pick<MapData, "blocks" | "projection">): FeatureCollection<OutlineProperties> {
  const features: Feature<OutlineProperties>[] = [];
  for (const block of data.blocks.features) {
    const kind = outlineKind(block.properties);
    for (const rings of polygonsOf(block.geometry)) {
      if (!rings.length) continue;
      const coordinates = insetLonLat(rings[0], data.projection);
      if (coordinates.length < 4) continue;
      features.push({ type: "Feature", id: block.id, properties: { id: block.id, kind }, geometry: { type: "LineString", coordinates } });
    }
  }
  return { type: "FeatureCollection", features };
}

/** The 2D block fill layer's filter, the same rule as `hasBlockFill`: an eligible block, or one with no eligibility, is filled; the others get only their faint outline. */
export const BLOCK_FILL_FILTER = ["any", ["!", ["has", "eligibility"]], ["==", ["get", "eligibility"], null], ["==", ["get", "eligibility"], "eligible"]] as const;

/** A block, with its polygons as [lon, lat] points (x = lon, z = lat), for finding the one under a click. */
export interface BlockEntry {
  id: string;
  polygons: { x: number; z: number }[][][];
  properties: BlockProperties;
}

export function blockEntries(data: Pick<MapData, "blocks">): BlockEntry[] {
  return data.blocks.features.flatMap((block) => {
    const polygons = polygonsOf(block.geometry).map((rings) => rings.map((ring) => ring.map(([x, z]) => ({ x, z }))));
    return polygons.length ? [{ id: block.id, polygons, properties: block.properties }] : [];
  });
}

/** The block under a clicked [lon, lat], or null. */
export function blockUnder(entries: readonly BlockEntry[], lngLat: { lng: number; lat: number }): BlockEntry | null {
  const id = blockAt(entries, lngLat.lng, lngLat.lat);
  return id ? (entries.find((entry) => entry.id === id) ?? null) : null;
}
