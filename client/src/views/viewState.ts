export type ViewName = "map" | "scene";

export const VIEWS: readonly ViewName[] = ["map", "scene"];

/** The view named by the URL hash (`#map`, `#scene`), so a reload keeps it. Anything else is the map. */
export function viewFromHash(hash: string): ViewName {
  const name = hash.replace(/^#/, "").split(/[/?&]/, 1)[0];
  return (VIEWS as readonly string[]).includes(name) ? (name as ViewName) : "map";
}
