import "./style.css";
import { ApiClient } from "./api/client";
import { BoundaryPanel } from "./boundaries/boundaryPanel";
import { ImportPanel } from "./importing/importPanel";
import { SelectionStore } from "./state/selection";
import { MapDataLayers } from "./views/mapDataLayers";
import { createMapView } from "./views/mapView";
import type { SceneView } from "./views/sceneView";
import { INITIAL_VIEW, VIEWS, viewFromHash, type ViewName } from "./views/viewState";

const api = new ApiClient();
/** The open area and scope, shared by every view. */
const selection = new SelectionStore(localStorage);
const mapView = createMapView(document.getElementById("map-view")!);
mapView.map.on("load", () => {
  const layers = new MapDataLayers(mapView.map);
  // The boundary panel needs the import panel's rectangle, and the import panel saves a traced shape
  // through the boundary panel once an import succeeds, so each is handed to the other as a callback.
  let boundaries: BoundaryPanel | undefined;
  const importPanel = new ImportPanel(document.getElementById("import-section")!, mapView.map, api, layers, selection, (areaId) =>
    boundaries?.saveTraced(areaId) ?? Promise.resolve(),
  );
  boundaries = new BoundaryPanel(document.getElementById("boundary-section")!, mapView.map, api, selection, () => importPanel.bbox);
});
// The 3D scene (and Three.js) loads only when the Scene tab is first opened, so a map-only session
// never downloads it or creates a WebGL context for it.
let sceneView: Promise<SceneView> | undefined;

function show(view: ViewName): void {
  for (const name of VIEWS) {
    document.getElementById(`${name}-view`)!.hidden = name !== view;
    document.querySelector(`[data-view="${name}"]`)?.setAttribute("aria-current", String(name === view));
  }
  if (view === "map") {
    void sceneView?.then((scene) => scene.hidden());
    mapView.shown();
  } else {
    sceneView ??= import("./views/sceneView").then(({ createSceneView }) => createSceneView(document.getElementById("scene-view")!));
    void sceneView.then((scene) => {
      if (viewFromHash(location.hash) === "scene") scene.shown();
    });
  }
}

window.addEventListener("hashchange", () => show(viewFromHash(location.hash)));
// Every page load opens on the map, whatever the hash says: the scene is built only when asked for.
if (viewFromHash(location.hash) !== INITIAL_VIEW) history.replaceState(null, "", `#${INITIAL_VIEW}`);
show(INITIAL_VIEW);

const status = document.getElementById("api-status")!;
api.health().then(
  () => {
    status.textContent = "API ok";
    status.dataset.state = "ok";
  },
  (error) => {
    status.textContent = "API unreachable";
    status.dataset.state = "down";
    status.title = String(error.message ?? error);
  },
);
