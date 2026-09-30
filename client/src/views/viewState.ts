export type ViewName = "map" | "scene";

export const VIEWS: readonly ViewName[] = ["map", "scene"];

/** What every page load shows. The scene is only built once the user opens its tab. */
export const INITIAL_VIEW: ViewName = "map";

/** The view named by the URL hash (`#map`, `#scene`), used when a tab is clicked. Anything else is the map. */
export function viewFromHash(hash: string): ViewName {
  const name = hash.replace(/^#/, "").split(/[/?&]/, 1)[0];
  return (VIEWS as readonly string[]).includes(name) ? (name as ViewName) : "map";
}
