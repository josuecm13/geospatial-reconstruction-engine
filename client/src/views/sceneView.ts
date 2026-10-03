import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MapData } from "../api/types";
import { buildWorld } from "../scene/buildWorld";
import { createCameraModes } from "../scene/cameraModes";
import { createExportButton } from "../scene/exportButton";
import { createRoutePanel, type RoutingDeps } from "../scene/routePanel";
import type { SceneTarget } from "../scene/sceneLoader";

export interface SceneView extends SceneTarget {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Starts rendering; the loop stops while the view is hidden. */
  shown(): void;
  hidden(): void;
}

const EMPTY_HINT = "Open an import on the Map tab";

/** The low-poly world of the open area: sky, light, and (once `setWorld` is called) the imported
 * city. Before that, a placeholder ground and grid, and a hint. */
export function createSceneView(container: HTMLElement, routing?: RoutingDeps): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#cfe3f2");
  scene.add(new THREE.HemisphereLight("#ffffff", "#7a8b6f", 1.4));
  const sun = new THREE.DirectionalLight("#fff4e0", 1.6);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  // The placeholder world, removed once a real one is loaded.
  const placeholder = new THREE.Group();
  const placeholderGround = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ color: "#d9d4c7" }));
  placeholderGround.rotation.x = -Math.PI / 2;
  placeholder.add(placeholderGround, new THREE.GridHelper(1000, 20, "#b8b2a4", "#c8c2b4"));
  scene.add(placeholder);

  const overlay = Object.assign(document.createElement("div"), { className: "scene-empty", textContent: EMPTY_HINT });
  const toggle = Object.assign(document.createElement("label"), { className: "scene-toggle", hidden: true });
  const buildable = Object.assign(document.createElement("input"), { type: "checkbox" });
  toggle.append(buildable, " Show buildable area");
  container.append(overlay, toggle);
  let world: THREE.Group | undefined;
  buildable.addEventListener("change", () => {
    const blocks = world?.getObjectByName("blocks");
    if (blocks) blocks.visible = buildable.checked;
  });

  const removeWorld = () => {
    if (!world) return;
    scene.remove(world);
    // Materials are shared across worlds, so only geometries are released.
    world.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
    world = undefined;
  };

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
  camera.position.set(0, 400, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI / 2.1;
  const modes = createCameraModes(camera, controls, renderer.domElement, container);
  const clock = new THREE.Clock();
  // Route between two picked points (routePanel.ts); clicks only pick while flying.
  const routes = routing && createRoutePanel(container, scene, camera, renderer.domElement, routing, () => modes.mode === "fly");

  const exporter = createExportButton(container);

  let running = false;
  const resize = () => {
    const { clientWidth, clientHeight } = container;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  const frame = () => {
    if (!running) return;
    const delta = clock.getDelta();
    if (modes.mode === "fly") controls.update();
    modes.update(delta);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };

  return {
    scene,
    camera,
    setWorld(data: MapData) {
      removeWorld();
      world = buildWorld(data);
      world.getObjectByName("blocks")!.visible = buildable.checked;
      scene.add(world);
      modes.setWorld(world);
      routes?.setWorld(world);
      exporter.setWorld(world);
      scene.remove(placeholder);
      overlay.hidden = true;
      toggle.hidden = false;
      // Frame the whole world from a raised, angled viewpoint.
      const box = new THREE.Box3().setFromObject(world);
      const center = box.getCenter(new THREE.Vector3());
      const size = Math.max(box.getSize(new THREE.Vector3()).length(), 50);
      camera.far = Math.max(5000, size * 10);
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      camera.position.set(center.x, center.y + size * 0.6, center.z + size * 0.7);
      controls.update();
    },
    showMessage(message: string) {
      removeWorld();
      modes.setWorld(undefined);
      routes?.setWorld(undefined);
      exporter.setWorld(undefined);
      scene.add(placeholder);
      overlay.textContent = message;
      overlay.hidden = false;
      toggle.hidden = true;
    },
    clear() {
      this.showMessage(EMPTY_HINT);
    },
    shown() {
      resize();
      modes.setActive(true);
      if (!running) {
        clock.getDelta();
        running = true;
        requestAnimationFrame(frame);
      }
    },
    hidden() {
      running = false;
      modes.setActive(false);
    },
  };
}
