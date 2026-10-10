import type { ImportArea } from "../api/types";

/** The first candidate that is completed, else the most recent completed area. */
export function pickFeatured(recent: readonly ImportArea[], ...candidates: (ImportArea | null)[]): ImportArea | null {
  return candidates.find((candidate) => candidate && candidate.status === "completed") ?? recent[0] ?? null;
}

/** Where the featured area's id can come from, in order: the server setting, then the build's `VITE_FEATURED_AREA_ID`. */
export interface FeaturedSources {
  /** The server's setting. A failed request (a rejection) falls through to the next source. */
  setting(): Promise<string | null>;
  /** The id from the environment variable, or null. */
  env: string | null;
  getArea(id: string): Promise<ImportArea>;
}

/**
 * The area the landing page features: the server setting, else `VITE_FEATURED_AREA_ID`, else the most
 * recent completed import. A source that fails, names a missing area, or names one that isn't
 * completed is skipped. An id that is not in `recent` (it may be older) is fetched.
 */
export async function resolveFeatured(recent: readonly ImportArea[], sources: FeaturedSources): Promise<ImportArea | null> {
  const load = async (id: string | null): Promise<ImportArea | null> => {
    if (!id) return null;
    return recent.find((area) => area.id === id) ?? (await sources.getArea(id).catch(() => null));
  };
  const fromSetting = await load(await sources.setting().catch(() => null));
  if (fromSetting?.status === "completed") return fromSetting;
  return pickFeatured(recent, await load(sources.env));
}
