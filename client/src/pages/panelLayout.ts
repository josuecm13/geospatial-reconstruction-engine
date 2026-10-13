/**
 * How the explore page lays out its import and boundary panel at a given width. The breakpoints are the
 * same as the media queries in style.css, which draw each layout; this decides only the default state
 * and what the toggle does.
 *
 * - `overlay` (900 px and up): a panel floating over the map's left side, always open.
 * - `side` (720 to 899 px): a docked side panel the toggle collapses; the map takes the rest.
 * - `sheet` (under 720 px): a bottom sheet over the map; collapsed it peeks, showing its header.
 */
export type PanelLayout = "overlay" | "side" | "sheet";

export const OVERLAY_MIN_WIDTH = 900;
export const SIDE_MIN_WIDTH = 720;

export function layoutFor(width: number): PanelLayout {
  if (width >= OVERLAY_MIN_WIDTH) return "overlay";
  return width >= SIDE_MIN_WIDTH ? "side" : "sheet";
}

/** Whether the panel's body is open when a layout starts: always on a wide screen, open beside the map, peeking on a phone. */
export function defaultOpen(layout: PanelLayout): boolean {
  return layout !== "sheet";
}

/** The state after the toggle is pressed. The overlay has no toggle, so it stays open. */
export function toggled(layout: PanelLayout, open: boolean): boolean {
  return layout === "overlay" ? true : !open;
}

export const SIDE_QUERY = `(max-width: ${OVERLAY_MIN_WIDTH - 1}px)`;
export const SHEET_QUERY = `(max-width: ${SIDE_MIN_WIDTH - 1}px)`;
