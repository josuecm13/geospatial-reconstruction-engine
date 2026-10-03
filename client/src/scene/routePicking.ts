import type { Position } from "../api/types";

/** Snap distances above this are warned about: the route starts at the nearest road, not the click. */
export const LARGE_SNAP_METERS = 25;

export type RoutePickState =
  | { phase: "idle" }
  | { phase: "origin"; origin: Position }
  | { phase: "requesting"; origin: Position; destination: Position }
  | { phase: "shown"; origin: Position; destination: Position }
  | { phase: "error"; origin: Position; destination: Position; code: string };

export const IDLE: RoutePickState = { phase: "idle" };

/** A click on the ground, as [longitude, latitude]. The first sets the origin, the second the
 * destination (and starts the request); a third, while anything is showing, starts over with
 * that click as the new origin. */
export function pick(state: RoutePickState, point: Position): RoutePickState {
  if (state.phase === "origin") return { phase: "requesting", origin: state.origin, destination: point };
  return { phase: "origin", origin: point };
}

/** The request came back. Ignored unless a request is still the current state. */
export function succeeded(state: RoutePickState): RoutePickState {
  return state.phase === "requesting" ? { phase: "shown", origin: state.origin, destination: state.destination } : state;
}

export function failed(state: RoutePickState, code: string): RoutePickState {
  return state.phase === "requesting" ? { phase: "error", origin: state.origin, destination: state.destination, code } : state;
}

/** Escape clears everything. */
export function clear(): RoutePickState {
  return IDLE;
}

/** "340 m" under a kilometre, "1.25 km" from there. */
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

/** The warning for a snap distance over the threshold, or null. */
export function snapWarning(which: "origin" | "destination", meters: number): string | null {
  if (meters <= LARGE_SNAP_METERS) return null;
  const verb = which === "origin" ? "starts" : "ends";
  return `Your ${which} point is ${Math.round(meters)} m from the nearest road; the route ${verb} there.`;
}

export const ROUTING_MESSAGES: Record<string, string> = {
  no_route_found: "No route connects these points.",
  no_navigable_node: "There's no road near that point.",
  invalid_coordinate: "That point isn't a valid location.",
  import_area_not_found: "That import area no longer exists.",
  import_area_not_ready: "That area hasn't finished importing yet.",
  database_unavailable: "The server can't reach its database.",
  http_error: "The API isn't answering. Is the server running?",
  network_error: "The API can't be reached. Is the server running?",
};
