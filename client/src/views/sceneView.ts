import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BoundingBox, MapData } from "../api/types";
import { prefersReducedMotion } from "../locations/flyTo";
import { buildWorld, LAYER_ORDER } from "../scene/buildWorld";
import { createAutoRotate, ROTATE_SPEED } from "../scene/autoRotate";
import { createCameraModes } from "../scene/cameraModes";
import { createFramingPolicy, overview, rectangleOverview } from "../scene/framing";
import { createExportButton } from "../scene/exportButton";
import { createRoutePanel, type RoutingDeps } from "../scene/routePanel";
import type { SceneTarget } from "../scene/sceneLoader";
import { bboxMeters, createStagedScene, type StagedHandle } from "../scene/stagedScene";

export interface SceneView extends SceneTarget {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Replaces the world with an empty one in `bbox` that the returned handle builds up, stage by stage. */
  beginStaged(bbox: BoundingBox): StagedHandle;
  /** Starts rendering; the loop stops while the view is hidden. */
  shown(): void;
  hidden(): void;
  /** Stops rendering and releases the WebGL context, for when the page is left. */
  dispose(): void;
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
  const placeholderGround = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ color: "#d9d4c7", depthWrite: false }));
  placeholderGround.rotation.x = -Math.PI / 2;
  placeholderGround.renderOrder = LAYER_ORDER.ground;
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
  // The row of buttons under the layer toggle: Rotate | Download glTF | Walk, right to left.
  const actions = Object.assign(document.createElement("div"), { className: "scene-actions" });
  container.appendChild(actions);
  const modes = createCameraModes(camera, controls, renderer.domElement, container, actions);
  // Turntable rotation in fly mode; never during a staged build (the waiting wireframe spins).
  const rotate = createAutoRotate(!prefersReducedMotion());
  controls.autoRotateSpeed = ROTATE_SPEED;
  // The user moving the camera (not auto-rotation, which fires no event) decides whether a finished
  // staged build keeps their view.
  const framing = createFramingPolicy();
  controls.addEventListener("start", () => {
    rotate.interactionStart();
    framing.userMoved();
  });
  controls.addEventListener("end", () => rotate.interactionEnd());
  let building = false;
  const clock = new THREE.Clock();
  // Route between two picked points (routePanel.ts); clicks only pick while flying.
  const routes = routing && createRoutePanel(container, scene, camera, renderer.domElement, routing, () => modes.mode === "fly");

  const exporter = createExportButton(actions);
  const rotateButton = Object.assign(document.createElement("button"), { className: "scene-rotate", type: "button", textContent: "Rotate", hidden: true });
  const showRotate = () => rotateButton.setAttribute("aria-pressed", String(rotate.enabled));
  showRotate();
  rotateButton.addEventListener("click", () => {
    rotate.setEnabled(!rotate.enabled);
    showRotate();
  });
  actions.appendChild(rotateButton);
  const staged = createStagedScene(scene, container);

  let running = false;
  const resize = () => {
    const { clientWidth, clientHeight } = container;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const frame = () => {
    if (!running) return;
    const delta = clock.getDelta();
    rotateButton.disabled = modes.mode !== "fly";
    const context = { fly: modes.mode === "fly", world: !!world, building };
    const turning = rotate.update(delta, context);
    if (context.fly) {
      controls.autoRotate = turning;
      controls.update(delta);
    }
    modes.update(delta);
    staged.update(delta);
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
      rotateButton.hidden = false;
      // Frame the whole world from a raised, angled viewpoint, unless the user moved the camera
      // during the staged build that this world finishes.
      const view = overview(new THREE.Box3().setFromObject(world));
      if (framing.shouldFrame()) {
        camera.far = view.far;
        controls.target.copy(view.target);
        camera.position.copy(view.position);
      } else {
        // The finished world can be bigger than the rectangle that was built.
        camera.far = Math.max(camera.far, view.far);
      }
      camera.updateProjectionMatrix();
      controls.update();
    },
    beginStaged(bbox) {
      removeWorld();
      modes.setWorld(undefined);
      routes?.setWorld(undefined);
      exporter.setWorld(undefined);
      framing.stagedStarted();
      const build = staged.begin(bbox);
      world = build.world;
      world.getObjectByName("blocks")!.visible = buildable.checked;
      scene.remove(placeholder);
      overlay.hidden = true;
      toggle.hidden = false;
      // The export waits for the build to play out; the finished world is loaded after it.
      exporter.setBusy(true);
      rotateButton.hidden = true;
      building = true;
      void build.handle.finished.then(() => {
        building = false;
        exporter.setBusy(false);
      });
      // Frame the rectangle, whose centre is the projection origin, from the usual raised viewpoint.
      const { width, height } = bboxMeters(bbox);
      const view = rectangleOverview(width, height);
      camera.far = view.far;
      camera.updateProjectionMatrix();
      controls.target.copy(view.target);
      camera.position.copy(view.position);
      controls.update();
      // An abandoned build reloads the previous area, which gets the overview, not this view.
      return {
        ...build.handle,
        abandon() {
          framing.reset();
          build.handle.abandon();
        },
      };
    },
    showMessage(message: string) {
      framing.reset();
      removeWorld();
      modes.setWorld(undefined);
      routes?.setWorld(undefined);
      exporter.setWorld(undefined);
      scene.add(placeholder);
      overlay.textContent = message;
      overlay.hidden = false;
      toggle.hidden = true;
      rotateButton.hidden = true;
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
    dispose() {
      running = false;
      modes.setActive(false);
      observer.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
