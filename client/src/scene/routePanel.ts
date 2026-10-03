import * as THREE from "three";
import type { Coordinate, Route } from "../api/types";
import { renderReportedError, useErrorReporter } from "../errors/errorReporter";
import { createRouteLayer } from "./routeLayer";
import { IDLE, ROUTING_MESSAGES, clear, failed, formatDistance, pick, snapWarning, succeeded, type RoutePickState } from "./routePicking";

/** What the panel needs of the API and of the selection. */
export interface RoutingDeps {
  api: {
    route(areaId: string, origin: Coordinate, destination: Coordinate, strategy?: string): Promise<Route>;
    routingStrategies(areaId: string): Promise<string[]>;
  };
  areaId(): string | null;
}

export interface RoutePanel {
  setWorld(world: THREE.Object3D | undefined): void;
}

const SERVER_DEFAULT = "";
const CLICK_SLOP_PIXELS = 5;
const HINT = "Click the origin, then the destination.";

const toCoordinate = ([longitude, latitude]: [number, number] | number[]): Coordinate => ({ latitude, longitude });

/**
 * The "Route" overlay of the scene: a toggle (while on, clicks pick points; dragging still orbits),
 * the strategy picker, and the result. Appended to `container`; the markers and ribbon go in `scene`.
 * `canPick` lets the host turn picking off (while walking).
 */
export function createRoutePanel(
  container: HTMLElement,
  scene: THREE.Scene,
  camera: THREE.Camera,
  canvas: HTMLElement,
  deps: RoutingDeps,
  canPick: () => boolean,
): RoutePanel {
  const layer = createRouteLayer(camera, canvas);
  scene.add(layer.root);
  const report = useErrorReporter(ROUTING_MESSAGES);

  const panel = Object.assign(document.createElement("div"), { className: "route-panel", hidden: true });
  const toggle = Object.assign(document.createElement("label"), { className: "route-toggle" });
  const enabled = Object.assign(document.createElement("input"), { type: "checkbox" });
  toggle.append(enabled, " Route");
  const strategy = Object.assign(document.createElement("select"), { className: "route-strategy", hidden: true });
  const output = Object.assign(document.createElement("div"), { className: "route-output" });
  panel.append(toggle, strategy, output);
  container.append(panel);

  let state: RoutePickState = IDLE;
  let strategiesFor: string | null = null;
  let lastError: unknown;

  const render = () => {
    const origin = state.phase === "idle" ? null : state.origin;
    const destination = "destination" in state ? state.destination : null;
    layer.setMarkers(origin, destination);
    if (state.phase !== "shown") layer.setRoute(null);
    output.className = "route-output";
    switch (state.phase) {
      case "idle":
        output.textContent = enabled.checked ? HINT : "";
        break;
      case "origin":
        output.textContent = "Now click the destination.";
        break;
      case "requesting":
        output.textContent = "Finding a route…";
        break;
      case "error":
        output.classList.add("route-error");
        renderReportedError(output, report(lastError));
        break;
      case "shown":
        break; // filled in by `showRoute`
    }
  };

  const showRoute = (route: Route) => {
    layer.setRoute(route.geometry);
    output.replaceChildren(`${formatDistance(route.total_distance_meters)} by ${route.strategy}`);
    for (const [which, meters] of [
      ["origin", route.origin_snap_distance_meters],
      ["destination", route.destination_snap_distance_meters],
    ] as const) {
      const line = Object.assign(document.createElement("div"), { textContent: `Snapped ${which}: ${Math.round(meters)} m to the nearest road` });
      const warning = snapWarning(which, meters);
      if (warning) line.append(Object.assign(document.createElement("div"), { className: "route-warning", textContent: warning }));
      output.append(line);
    }
  };

  const loadStrategies = async () => {
    const areaId = deps.areaId();
    if (!areaId || areaId === strategiesFor) return;
    strategiesFor = areaId;
    const names = await deps.api.routingStrategies(areaId);
    if (strategiesFor !== areaId) return;
    // No list means the probe failed: only the server's default is offered (no `strategy` is sent).
    const options = names.length ? names : ["server default"];
    strategy.replaceChildren(
      ...options.map((name, i) => Object.assign(document.createElement("option"), { value: names.length ? name : SERVER_DEFAULT, textContent: name, selected: i === 0 })),
    );
    strategy.hidden = false;
  };

  const request = async (current: Extract<RoutePickState, { phase: "requesting" }>) => {
    const areaId = deps.areaId();
    if (!areaId) return;
    try {
      const route = await deps.api.route(areaId, toCoordinate(current.origin), toCoordinate(current.destination), strategy.value || undefined);
      if (state !== current) return; // the user started over meanwhile
      state = succeeded(state);
      render();
      showRoute(route);
    } catch (error) {
      if (state !== current) return;
      lastError = error;
      state = failed(state, (error as { code?: string }).code ?? "unknown");
      render();
    }
  };

  // A click is a press and release that barely moved, so orbiting by dragging doesn't pick.
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    const start = down;
    down = null;
    if (!enabled.checked || !canPick() || !start || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PIXELS) return;
    const point = layer.pick(event.clientX, event.clientY);
    if (!point) return;
    state = pick(state, point);
    render();
    if (state.phase === "requesting") void request(state);
  });
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || !enabled.checked || panel.hidden) return;
    state = clear();
    render();
  });
  enabled.addEventListener("change", () => {
    canvas.style.cursor = enabled.checked ? "crosshair" : "";
    if (enabled.checked) void loadStrategies();
    render();
  });

  return {
    setWorld(world) {
      layer.setWorld(world);
      state = IDLE;
      strategiesFor = null;
      panel.hidden = !world;
      if (world && enabled.checked) void loadStrategies();
      render();
    },
  };
}
