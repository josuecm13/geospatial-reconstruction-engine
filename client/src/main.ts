import "./style.css";
import { ApiClient } from "./api/client";
import { ImportPanel } from "./importing/importPanel";
import { MapDataLayers } from "./views/mapDataLayers";
import { createMapView } from "./views/mapView";
import type { SceneView } from "./views/sceneView";
import { VIEWS, viewFromHash, type ViewName } from "./views/viewState";

const api = new ApiClient();
const mapView = createMapView(document.getElementById("map-view")!);
mapView.map.on("load", () => {
  const layers = new MapDataLayers(mapView.map);
  new ImportPanel(document.getElementById("import-panel")!, mapView.map, api, layers);
});
// The 3D scene (and Three.js) loads on first visit, so a map-only session never downloads it or
// creates a WebGL context for it.
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
show(viewFromHash(location.hash));

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
