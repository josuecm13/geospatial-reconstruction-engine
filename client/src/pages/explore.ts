import { ApiError } from "../api/client";
import type { ImportArea } from "../api/types";
import { BoundaryPanel } from "../boundaries/boundaryPanel";
import { useErrorReporter } from "../errors/errorReporter";
import { ImportPanel } from "../importing/importPanel";
import type { StagedTarget } from "../importing/stagedImport";
import { consumeFlyTo } from "../locations/flyTo";
import { formatRoute, type ExploreRoute, type ExploreView, type Route } from "../routing/routes";
import { SceneLoader } from "../scene/sceneLoader";
import { SelectionStore, type Scope } from "../state/selection";
import { MapDataLayers } from "../views/mapDataLayers";
import { createMapView } from "../views/mapView";
import type { SceneView } from "../views/sceneView";
import type { Mount } from "./types";

const VIEWS: readonly ExploreView[] = ["map", "scene"];
const LABELS: Record<ExploreView, string> = { map: "Map", scene: "Scene" };

const WHOLE_AREA: Scope = { type: "import_area" };

const scopeOf = (route: ExploreRoute): Scope => (route.scope ? { type: "boundary", boundaryId: route.scope } : WHOLE_AREA);
const scopeId = (scope: Scope): string | null => (scope.type === "boundary" ? scope.boundaryId : null);

/**
 * `/explore/:areaId`: the 2D map with its import and boundary panels, and the lazily built 3D scene.
 * The route is the source of truth for the area, scope, view and map camera. The page stays mounted
 * while those change: it follows the route (back, forward, a pasted link) and writes its own changes
 * back, comparing before it writes so the two never loop.
 */
export const mount: Mount<ExploreRoute> = (el, ctx) => {
  const { api, router } = ctx;
  const routeNow = (): ExploreRoute => {
    const route = router.get();
    return route.page === "explore" ? route : ctx.route;
  };
  const start = routeNow();

  el.innerHTML = `
    <section id="map-view" class="view" aria-label="2D map"></section>
    <aside id="import-panel" class="panel" aria-label="Import and boundaries">
      <div id="import-section"></div>
      <div id="boundary-section" class="panel-section"></div>
    </aside>
    <section id="scene-view" class="view" aria-label="3D scene" hidden></section>`;
  const pick = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;

  let disposed = false;
  // True while the page is moving the selection to match the route; selection changes made then are not user changes.
  let applying = false;
  let applies = 0;

  // The open area and scope. Set from the URL before any panel is built, so each opens what the URL names.
  const selection = new SelectionStore(localStorage);
  selection.setArea(start.areaId);
  selection.setScope(scopeOf(start));

  /** Writes the selection into the route, unless the route already says it. */
  const writeRoute = (replace: boolean) => {
    const chosen = selection.get();
    const now = router.get();
    if (!chosen.areaId || now.page !== "explore") return;
    const scope = scopeId(chosen.scope);
    if (chosen.areaId === now.areaId && scope === now.scope) return;
    // Another area starts with its own camera; a scope change keeps the map where it is.
    router.navigate({ ...now, areaId: chosen.areaId, scope, at: chosen.areaId === now.areaId ? now.at : null }, { replace });
  };
  const unsubscribeSelection = selection.subscribe(() => {
    if (!applying) writeRoute(false);
  });

  // --- tabs ---
  const links = VIEWS.map((name) => {
    const link = Object.assign(document.createElement("a"), { textContent: LABELS[name] });
    link.dataset.link = "";
    link.dataset.view = name;
    return link;
  });
  ctx.tabs.replaceChildren(...links);
  ctx.tabs.hidden = false;
  const renderTabs = (route: ExploreRoute) => {
    for (const link of links) {
      const name = link.dataset.view as ExploreView;
      link.href = formatRoute({ ...route, view: name });
      link.setAttribute("aria-current", String(name === route.view));
    }
  };

  let view: ExploreView = start.view;

  // --- map and panels ---
  const mapView = createMapView(pick("map-view"));
  let importPanel: ImportPanel | undefined;
  mapView.map.on("moveend", () => {
    if (disposed || view !== "map") return;
    const center = mapView.map.getCenter();
    router.setCamera({ lat: center.lat, lon: center.lng, zoom: mapView.map.getZoom() });
  });
  mapView.map.on("load", () => {
    if (disposed) return;
    const layers = new MapDataLayers(mapView.map);
    // The boundary panel needs the import panel's rectangle, and the import panel saves a traced shape
    // through the boundary panel once an import succeeds, so each is handed to the other as a callback.
    let boundaries: BoundaryPanel | undefined;
    const panel = new ImportPanel(
      pick("import-section"),
      mapView.map,
      api,
      layers,
      selection,
      (areaId) => boundaries?.saveTraced(areaId) ?? Promise.resolve(),
      stagedTarget,
    );
    importPanel = panel;
    boundaries = new BoundaryPanel(pick("boundary-section"), mapView.map, api, selection, () => panel.bbox);
    void applyRoute(routeNow(), true);
  });

  /** Makes the selection (and the panels following it) match `route`. */
  async function applyRoute(route: ExploreRoute, initial = false): Promise<void> {
    const panel = importPanel;
    if (!panel) return; // before the map has loaded; its load handler applies the route then
    const mine = ++applies;
    applying = true;
    try {
      if (initial || selection.get().areaId !== route.areaId) {
        let area: ImportArea | undefined;
        try {
          area = await api.getImportArea(route.areaId);
        } catch (error) {
          if (error instanceof ApiError && error.code === "import_area_not_found") {
            if (!disposed) router.navigate({ page: "not-found", path: formatRoute(route) }, { replace: true });
            return;
          }
          // Anything else: let the panel try again and show the error.
        }
        if (mine !== applies || disposed) return;
        // A page that opens on this URL (a pasted link, a reload) jumps to the area, unless a gallery card
        // asked for the fly. Moving to another area while the page is open always flies.
        const gallery = consumeFlyTo(route.areaId);
        await panel.open(route.areaId, { area, instant: initial && !gallery, camera: route.at });
        if (mine !== applies || disposed) return;
      }
      if (!initial) selection.setScope(scopeOf(route));
    } finally {
      if (mine === applies) {
        applying = false;
        // The area can have opened differently from the URL (a deleted boundary falls back to the whole area).
        if (!disposed) writeRoute(true);
      }
    }
  }

  // --- the scene: Three.js loads only when the Scene view is first shown ---
  let sceneView: Promise<SceneView> | undefined;
  let sceneLoader: SceneLoader | undefined;
  const sceneErrors = useErrorReporter({
    import_area_not_found: "That import area no longer exists. Open another one on the Map tab.",
    boundary_not_found: "That boundary no longer exists. Pick another scope on the Map tab.",
    http_error: "The API isn't answering. Is the server running?",
    database_unavailable: "The server can't reach its database.",
  });

  function show(name: ExploreView): void {
    pick("map-view").hidden = name !== "map";
    pick("scene-view").hidden = name !== "scene";
    // The side panel belongs to the map; style.css hides it while the map is hidden.
    if (name === "map") {
      void sceneView?.then((scene) => {
        scene.hidden();
        sceneLoader?.hidden();
      });
      if (importPanel) importPanel.mapShown();
      else mapView.shown();
    } else {
      sceneView ??= import("../views/sceneView").then(({ createSceneView }) => {
        const created = createSceneView(pick("scene-view"), { api, areaId: () => selection.get().areaId });
        sceneLoader = new SceneLoader(api, selection, created, (error) => sceneErrors(error).sentence);
        return created;
      });
      void sceneView.then((scene) => {
        if (disposed || view !== "scene") return;
        scene.shown();
        sceneLoader?.shown();
      });
    }
  }

  const goTo = (name: ExploreView) => {
    const now = router.get();
    if (!disposed && now.page === "explore") router.navigate({ ...now, view: name });
  };

  // An import is built in the scene as the server streams it. The scene loader waits while it plays, so
  // the finished area replaces the build only once the animation is over (or skipped).
  const stagedTarget: StagedTarget = {
    async begin(bbox) {
      goTo("scene");
      const scene = await sceneView!;
      sceneLoader!.suspend();
      const handle = scene.beginStaged(bbox);
      void handle.finished.then(() => sceneLoader?.resume());
      // A failed import shows its error in the Map view's import panel, so go back to it.
      return {
        ...handle,
        abandon() {
          handle.abandon();
          goTo("map");
        },
      };
    },
  };

  // --- the route drives the page ---
  const unsubscribeRoute = router.subscribe((route: Route) => {
    if (route.page !== "explore") return; // the page host is about to unmount this page
    renderTabs(route);
    if (route.view !== view) {
      view = route.view;
      show(view);
    }
    // A camera-only change (the map's own replaceState) needs nothing from the selection.
    const chosen = selection.get();
    if (chosen.areaId !== route.areaId || scopeId(chosen.scope) !== route.scope) void applyRoute(route);
  });

  renderTabs(start);
  show(view);

  return () => {
    disposed = true;
    applies += 1;
    unsubscribeRoute();
    unsubscribeSelection();
    ctx.tabs.replaceChildren();
    ctx.tabs.hidden = true;
    void sceneView?.then((scene) => {
      sceneLoader?.hidden();
      scene.dispose();
    });
    mapView.map.remove();
  };
};
