import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BoundingBox, MapData, Projection } from "../api/types";
import { prefersReducedMotion } from "../locations/flyTo";
import { Animator, staggerDelay } from "../scene/buildAnimation";
import { buildWorld, DEFAULT_ROAD_MODE, generatedMeshes, LAYER_ORDER, registerFeatures, roadOutlineLines, setRoadMode, WORLD_GROUPS } from "../scene/buildWorld";
import { applyDetail } from "../scene/detailLevels";
import { RevealQueue } from "../scene/revealQueue";
import { pointDelays } from "../scene/revealSchedule";
import type { GeneratedFeature } from "../scene/generationStream";
import type { Terrain } from "../scene/terrain";
import { activeTheme, COLORS, MATERIALS, restyle, SCENE_BACKGROUND, setActiveTheme } from "../scene/palette";
import { createAtmosphere } from "../scene/atmosphere";
import { themeById } from "../scene/themes";
import type { ThemeId, TimeOfDay } from "../scene/themes/types";
import { shadeGeometry } from "../scene/shading";
import { createAutoRotate, ROTATE_SPEED } from "../scene/autoRotate";
import { createCameraModes } from "../scene/cameraModes";
import { createFramingPolicy, overview, rectangleOverview } from "../scene/framing";
import { createExportButton } from "../scene/exportButton";
import { createPinLayer } from "../scene/pinLayer";
import { createFlyIntent, createTargetEase, type Vec3 } from "../scene/pinPoint";
import { createToolGroup } from "../scene/toolGroup";
import { createBlockSelection } from "../scene/blockSelection";
import { createGenerationControls, type GenerationDeps, type GenerationSink } from "../scene/generationControls";
import { createTerrainControls, type TerrainDeps } from "../scene/terrainControls";
import { createRoutePanel, type RoutingDeps } from "../scene/routePanel";
import type { SceneTarget } from "../scene/sceneLoader";
import { bboxMeters, createStagedScene, type StagedHandle } from "../scene/stagedScene";
import { createZoneLegend } from "../scene/zoneLegend";
import { loadThemeChoice, saveThemeChoice } from "../scene/themeChoice";
import { createFpsReadout } from "../scene/fpsReadout";
import { createPixelRatioController, initialPixelRatio } from "../scene/pixelRatio";
import { createThemeControls } from "../scene/themeControls";
import type { ApiClient } from "../api/client";

export interface SceneView extends SceneTarget {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Replaces the world with an empty one in `bbox` that the returned handle builds up, stage by stage. */
  beginStaged(bbox: BoundingBox): StagedHandle;
  /** Shows the scene in this theme (an unknown id falls back to Night clay): every layer, the sky, the lights and the fog, with no rebuild. */
  setTheme(id: ThemeId): void;
  /** Moves the sun and sky to a time of day, animated unless the user prefers reduced motion. Nothing changes in a theme that does not follow the sun. */
  setTimeOfDay(time: TimeOfDay): void;
  /** Starts rendering; the loop stops while the view is hidden. */
  shown(): void;
  hidden(): void;
  /** Stops rendering and releases the WebGL context, for when the page is left. */
  dispose(): void;
}

const EMPTY_HINT = "Open an import on the Map tab";

/** The low-poly world of the open area: background and (once `setWorld` is called) the imported
 * city. Before that, a placeholder ground and grid, and a hint. */
export function createSceneView(container: HTMLElement, routing?: RoutingDeps, terrain?: TerrainDeps, generation?: GenerationDeps, themeApi?: Pick<ApiClient, "setLandingTheme">): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  // Antialiasing stays on (a context fixes it at creation) and costs MSAA samples at every pixel; the pixel ratio cap, stepped down further under load, is the main saving.
  const pixelRatioCap = initialPixelRatio(window.devicePixelRatio);
  const pixelRatio = createPixelRatioController(pixelRatioCap);
  renderer.setPixelRatio(pixelRatioCap);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BACKGROUND); // until the atmosphere sets the active sky's horizon
  // The stored choice (Night clay at midday when there is none), applied with no animation.
  const stored = loadThemeChoice();
  let theme = themeById(stored.theme);
  let timeOfDay = stored.time; // the time on show, for the glTF export's extras
  const atmosphere = createAtmosphere(scene, renderer);
  atmosphere.setTheme(theme);
  atmosphere.setTime(stored.time, { animate: false });

  // The placeholder world, removed once a real one is loaded.
  const placeholder = new THREE.Group();
  const placeholderGround = new THREE.Mesh(shadeGeometry(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2)), MATERIALS.ground);
  placeholderGround.renderOrder = LAYER_ORDER.ground;
  placeholder.add(placeholderGround, new THREE.GridHelper(1000, 20, COLORS.gridCenter, COLORS.gridLine));
  scene.add(placeholder);

  const overlay = Object.assign(document.createElement("div"), { className: "scene-empty", textContent: EMPTY_HINT });
  const toggle = Object.assign(document.createElement("div"), { className: "scene-toggle", hidden: true });
  const buildable = Object.assign(document.createElement("input"), { type: "checkbox" });
  const buildableLabel = document.createElement("label");
  buildableLabel.append(buildable, " Show blocks");
  // Only for an area with terrain: roads follow the smoothed heights (a low-pass of the ground) or the exact ones.
  const smooth = Object.assign(document.createElement("input"), { type: "checkbox", checked: DEFAULT_ROAD_MODE === "smoothed" });
  const smoothLabel = Object.assign(document.createElement("label"), { hidden: true });
  smoothLabel.append(smooth, " Smooth roads");
  toggle.append(buildableLabel, smoothLabel);
  // The OSM credit is on the 2D map; the scene credits the terrain when it has one (see the world's `elevation`).
  const credit = Object.assign(document.createElement("div"), { className: "scene-attribution", hidden: true });
  container.append(overlay, toggle, credit);
  let world: THREE.Group | undefined;
  /** The map data of the world on screen, and the generated features streamed into it since: what the glTF export rebuilds the world from (see `exportSource`). */
  let mapData: MapData | undefined;
  let streamed: GeneratedFeature[] = [];
  // "Show blocks": the dashed block outlines, the faint buildable-area fill under them, and the generation zones (with their legend). Blocks can only be picked while it is on.
  const zoneLegend = createZoneLegend(container);
  let blockSelection: ReturnType<typeof createBlockSelection> | undefined;
  const showBlocks = () => {
    const blocks = world?.getObjectByName("blocks");
    if (blocks) blocks.visible = buildable.checked;
    zoneLegend.setVisible(buildable.checked);
    blockSelection?.setEnabled(buildable.checked);
  };
  buildable.addEventListener("change", showBlocks);
  const roadMode = () => (smooth.checked ? "smoothed" : "exact");
  smooth.addEventListener("change", () => {
    if (world) setRoadMode(world, roadMode());
    atmosphere.invalidateShadows();
  });
  /** What the toggles and the credit show for the world on screen (`undefined`: no finished world). */
  const showTerrain = (data: MapData | undefined) => {
    smoothLabel.hidden = !data?.elevation;
    credit.hidden = !data?.elevation;
    credit.textContent = data?.elevation ? `${data.attribution} · ${data.elevation.attribution}` : "";
  };

  // The generated buildings rise block by block on an accelerating schedule (scene/revealSchedule.ts): as a job streams
  // them in (the RevealQueue plays them on the schedule's clock) and, when "Show generated" is ticked, from the centre out.
  const animator = new Animator();
  type Item = { feature: GeneratedFeature; projection: Projection };
  const reveal = new RevealQueue<Item>();
  const generatedGroup = () => world?.getObjectByName("generated");
  let rising = 0; // rises in flight
  const idleWaiters: ((drained: boolean) => void)[] = [];
  const skipReveal = Object.assign(document.createElement("button"), { className: "scene-skip", type: "button", textContent: "Skip animation", hidden: true });
  container.appendChild(skipReveal);
  const busy = () => rising > 0 || reveal.size > 0;
  /** Shows Skip while a reveal plays; once it has drained, tells whoever waits (a completed job's reload). */
  const settle = () => {
    skipReveal.hidden = !busy();
    if (!busy()) idleWaiters.splice(0).forEach((resolve) => resolve(true));
  };
  const track = (rise: Promise<void>) => {
    rising++;
    skipReveal.hidden = false;
    void rise.then(() => {
      rising--;
      settle();
    });
  };
  /** Drops what is waiting and finishes every rise in flight, so nothing is left at scale 0. `abandoned`: the world is gone, so waiters are told not to reload. */
  const cancelReveal = (abandoned: boolean) => {
    reveal.start();
    if (abandoned) idleWaiters.splice(0).forEach((resolve) => resolve(false));
    animator.reset();
    settle();
  };
  /** Meshes under the `generated` group go; geometries are released (materials are shared). */
  const clearGenerated = () => {
    cancelReveal(false);
    const generated = generatedGroup();
    if (!generated) return;
    const known: Map<string, object> | undefined = world?.userData.features;
    for (const child of [...generated.children]) {
      generated.remove(child);
      for (const id of (child.userData.featureIds as string[] | undefined) ?? []) known?.delete(id);
      child.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
    }
    streamed = [];
  };
  /** Builds and adds the meshes of one block's due features, rising together (instant under reduced motion). */
  const spawn = (items: Item[], instant: boolean) => {
    const generated = generatedGroup();
    const terrain: Terrain | undefined = world?.userData.terrain;
    if (!generated || !terrain || !items.length) return;
    // The ids already drawn, from the chunks of these items' blocks (a block is one chunk, so only those are scanned).
    const blocks = new Set(items.map(({ feature }) => feature.properties.block_id));
    const present = new Set(generated.children.filter((child) => blocks.has(child.userData.block)).flatMap((child) => child.userData.featureIds as string[]));
    const fresh = items.filter(({ feature }) => !present.has(feature.id));
    // One chunk per block: the items arrive a block at a time, so these are the block's buildings merged.
    const meshes = fresh.length ? generatedMeshes(fresh.map(({ feature }) => feature), terrain, fresh[0].projection) : [];
    if (!meshes.length) return;
    registerFeatures(world!, fresh.map(({ feature }) => feature));
    streamed.push(...fresh.map(({ feature }) => feature));
    generated.add(...meshes);
    atmosphere.invalidateShadows();
    generated.visible = true;
    if (instant || prefersReducedMotion()) return;
    track(animator.riseAt(meshes, meshes.map((_, i) => staggerDelay(i, meshes.length))));
  };
  const playReveal = (groups: { items: Item[] }[], instant = false) => {
    for (const group of groups) spawn(group.items, instant);
    settle();
  };
  skipReveal.addEventListener("click", () => {
    playReveal(reveal.flush(), true);
    animator.reset();
    settle();
  });
  const streamSink: GenerationSink = {
    clear: clearGenerated,
    add(features, projection, _blocksDone, blockCount) {
      if (!generatedGroup()) return;
      reveal.expect(blockCount);
      const byBlock = new Map<string, Item[]>();
      for (const feature of features) byBlock.set(feature.properties.block_id, [...(byBlock.get(feature.properties.block_id) ?? []), { feature, projection }]);
      if (prefersReducedMotion()) {
        for (const items of byBlock.values()) spawn(items, true);
        return;
      }
      // Each block waits for its slot on the schedule, or rises on arrival when the server is slower than that.
      for (const [block, items] of byBlock) reveal.add(block, items);
      skipReveal.hidden = !busy();
    },
    whenIdle: () => (busy() ? new Promise<boolean>((resolve) => idleWaiters.push(resolve)) : Promise.resolve(true)),
  };
  /** Ticked: the buildings rise block by block from the centre, over about five seconds. Unticked: they hide at once, cancelling a reveal in progress (a fade would need its own tween for little gain). Both instant under reduced motion. */
  const showGenerated = (shown: boolean, animate = false) => {
    const generated = generatedGroup();
    if (!generated) return;
    generated.visible = shown;
    if (shown && !animate) return; // a job streaming in, or a world just loaded: leave the rises in flight alone
    cancelReveal(false); // finishes what is in flight, so re-ticking restarts cleanly
    generated.visible = shown;
    if (!shown || prefersReducedMotion()) return;
    const meshes = generated.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh);
    const points = meshes.map((mesh) => {
      const at = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      return { block: String((mesh.userData.block as string | undefined) ?? mesh.name), x: at.x, z: at.z };
    });
    track(animator.riseAt(meshes, pointDelays(points, { x: centre.x, z: centre.z })));
  };

  /** Makes `theme` the one meshes are built with and every mesh, the sky, the lights and the fog take its look. */
  const applyTheme = () => {
    setActiveTheme(theme);
    restyle(scene);
    atmosphere.setTheme(theme);
    syncRoadOutlines();
  };
  // Restyle what exists (the placeholder) to the stored theme, then settle its sky at the stored time.
  applyTheme();
  atmosphere.setTime(stored.time, { animate: false });

  // The theme picker, the time buttons and "Use on landing"; a change applies and is remembered.
  const themeControls = createThemeControls(container, {
    initial: stored,
    onTheme: (id) => {
      theme = themeById(id);
      applyTheme();
      saveThemeChoice(themeControls.choice());
    },
    onTime: (time) => {
      timeOfDay = time;
      atmosphere.setTime(time, { animate: !prefersReducedMotion() });
      saveThemeChoice(themeControls.choice());
    },
    setLandingTheme: themeApi && ((value) => themeApi.setLandingTheme(value)),
  });

  /** Blueprint draws the roads' outlines: built once per world, the first time Blueprint is applied to it, and shown only there. */
  function syncRoadOutlines() {
    if (!world) return;
    const roads = world.getObjectByName("roads");
    if (!roads) return;
    let outlines = roads.getObjectByName("road_outlines");
    if (!outlines && theme.mode === "line" && world.userData.roadOutlines) {
      outlines = roadOutlineLines(world);
      roads.add(outlines);
    }
    if (outlines) outlines.visible = theme.mode === "line";
  }

  const removeWorld = () => {
    cancelReveal(true);
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
  controls.zoomToCursor = true;
  // The row of buttons under the layer toggle: Rotate | Download glTF | Walk, right to left.
  const actions = Object.assign(document.createElement("div"), { className: "scene-actions" });
  container.appendChild(actions);
  // Back from walk to fly, the orbit target eases to the shared pin (or the centre, after a reset in walk mode),
  // keeping the camera's distance and angle.
  const flyIntent = createFlyIntent();
  const modes = createCameraModes(camera, controls, renderer.domElement, container, actions, () => {
    const destination = flyIntent.take();
    if (!destination) return;
    easeOffset.subVectors(camera.position, controls.target);
    ease.start({ x: controls.target.x, y: controls.target.y, z: controls.target.z }, destination);
  });
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
  // Set point and Route both turn clicks into picks, so arming one disarms the other.
  const tools = createToolGroup();
  const armRoute = tools.join("route", () => routes?.disarm());
  const armPin = tools.join("pin", () => pins.disarm());
  const routes = routing && createRoutePanel(container, scene, camera, renderer.domElement, routing, () => modes.mode === "fly", armRoute);

  // Set point: the pin the orbit target eases to (keeping the camera's offset), and walk mode starts at.
  // The area's centre is where "Reset to centre" goes back to.
  const ease = createTargetEase(prefersReducedMotion);
  const easeOffset = new THREE.Vector3();
  let centre: Vec3 = { x: 0, y: 0, z: 0 };
  const pins = createPinLayer(
    scene,
    camera,
    renderer.domElement,
    actions,
    (pin) => {
      modes.setPin(pin);
      // The pin is one point for both modes: set while walking, it waits for the return to fly.
      if (modes.mode !== "fly") return flyIntent.request(pin, centre);
      easeOffset.subVectors(camera.position, controls.target);
      ease.start({ x: controls.target.x, y: controls.target.y, z: controls.target.z }, pin ?? centre);
    },
    armPin,
  );

  // Click a block to see how many buildings it has and tell the engine how many it should: not while walking, and not while Set point or Route have the click (both show a crosshair).
  blockSelection =
    generation && createBlockSelection(camera, renderer.domElement, container, generation.api, () => modes.mode === "fly" && renderer.domElement.style.cursor !== "crosshair");

  /**
   * What the glTF export writes: the world rebuilt from its map data with one mesh per feature (`building:<id>`, `generated:<id>`
   * nodes, as the spec requires; the on-screen world is merged chunks), the generated buildings streamed in since included, the
   * layers hidden on screen hidden here too, and Blueprint's road outlines when that theme is on. Falls back to the live world.
   */
  const exportSource = (live: THREE.Group): THREE.Group => {
    if (!mapData) return live;
    const drawn = mapData.generated_buildings?.features ?? [];
    const ids = new Set(drawn.map((feature) => feature.id));
    const generated = { type: "FeatureCollection" as const, features: [...drawn, ...streamed.filter((feature) => !ids.has(feature.id))] };
    const copy = buildWorld({ ...mapData, generated_buildings: generated }, live.userData.roadMode, { batched: false });
    for (const name of WORLD_GROUPS) copy.getObjectByName(name)!.visible = live.getObjectByName(name)?.visible ?? true;
    if (activeTheme().mode === "line" && copy.userData.roadOutlines) copy.getObjectByName("roads")!.add(roadOutlineLines(copy));
    return copy;
  };
  const exporter = createExportButton(actions, () => ({ theme: activeTheme().id, timeOfDay }), exportSource);
  const terrainControls = terrain && createTerrainControls(actions, container, terrain);
  // Generate / Regenerate, its progress line, and "Show generated" beside "Smooth roads": the generated buildings are the `generated` group.
  const generationControls =
    generation &&
    createGenerationControls(actions, container, toggle, generation, showGenerated, streamSink);
  const rotateButton = Object.assign(document.createElement("button"), { className: "scene-rotate", type: "button", textContent: "Rotate", hidden: true });
  const showRotate = () => rotateButton.setAttribute("aria-pressed", String(rotate.enabled));
  showRotate();
  rotateButton.addEventListener("click", () => {
    rotate.setEnabled(!rotate.enabled);
    showRotate();
  });
  actions.appendChild(rotateButton);
  const staged = createStagedScene(scene, container);

  const fpsReadout = createFpsReadout(container, renderer, { theme: () => theme.id, shadowRedraws: () => atmosphere.shadowRedraws(), pixelRatio: () => renderer.getPixelRatio() });
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
    fpsReadout?.frame(delta * 1000);
    const adapted = pixelRatio.frame(delta * 1000);
    if (adapted !== renderer.getPixelRatio()) {
      renderer.setPixelRatio(adapted);
      resize(); // setSize applies the new ratio to the canvas
    }
    rotateButton.disabled = modes.mode !== "fly";
    const context = { fly: modes.mode === "fly", world: !!world, building };
    const turning = rotate.update(delta, context);
    if (context.fly) {
      const eased = ease.step(delta * 1000);
      if (eased) {
        controls.target.set(eased.x, eased.y, eased.z);
        camera.position.copy(controls.target).add(easeOffset);
      }
      controls.autoRotate = turning;
      controls.update(delta);
    }
    modes.update(delta);
    animator.update(delta);
    // Cells far below the camera drop their edges and then their buildings for boxes (throttled inside); the staged build keeps full detail.
    if (world && !building && applyDetail(world, camera, container.clientHeight)) atmosphere.invalidateShadows();
    atmosphere.update(delta, camera, controls.target, { buildAnimating: building || busy() });
    if (reveal.size) playReveal(reveal.update(delta));
    staged.update(delta);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };

  return {
    scene,
    camera,
    setWorld(data: MapData) {
      removeWorld();
      mapData = data;
      streamed = [];
      world = buildWorld(data, roadMode());
      blockSelection?.setWorld(world);
      zoneLegend.setReasons(data.generation_zones?.features.map((zone) => zone.properties.reason) ?? []);
      showBlocks();
      scene.add(world);
      syncRoadOutlines();
      atmosphere.invalidateShadows();
      showTerrain(data);
      terrainControls?.setWorld(!data.elevation);
      generationControls?.setWorld(data.generation ?? null);
      modes.setWorld(world);
      flyIntent.take(); // a pin from the old world is gone
      pins.setWorld(world);
      routes?.setWorld(world);
      exporter.setWorld(world);
      scene.remove(placeholder);
      overlay.hidden = true;
      toggle.hidden = false;
      rotateButton.hidden = false;
      // Frame the whole world from a raised, angled viewpoint, unless the user moved the camera
      // during the staged build that this world finishes.
      const view = overview(new THREE.Box3().setFromObject(world));
      centre = { x: view.target.x, y: view.target.y, z: view.target.z };
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
      mapData = undefined;
      modes.setWorld(undefined);
      flyIntent.take(); // a pin from the old world is gone
      pins.setWorld(undefined);
      routes?.setWorld(undefined);
      exporter.setWorld(undefined);
      framing.stagedStarted();
      showTerrain(undefined);
      terrainControls?.setWorld(false);
      generationControls?.clear();
      const build = staged.begin(bbox);
      world = build.world;
      blockSelection?.setWorld(undefined);
      zoneLegend.setReasons([]);
      showBlocks();
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
    setTheme(id) {
      theme = themeById(id);
      applyTheme();
    },
    setTimeOfDay(time) {
      timeOfDay = time;
      atmosphere.setTime(time, { animate: !prefersReducedMotion() });
    },
    showMessage(message: string) {
      framing.reset();
      removeWorld();
      mapData = undefined;
      blockSelection?.setWorld(undefined);
      zoneLegend.setReasons([]);
      modes.setWorld(undefined);
      flyIntent.take(); // a pin from the old world is gone
      pins.setWorld(undefined);
      routes?.setWorld(undefined);
      exporter.setWorld(undefined);
      scene.add(placeholder);
      showTerrain(undefined);
      terrainControls?.setWorld(false);
      generationControls?.clear();
      overlay.textContent = message;
      overlay.hidden = false;
      toggle.hidden = true;
      rotateButton.hidden = true;
    },
    clear() {
      this.showMessage(EMPTY_HINT);
    },
    shown() {
      applyTheme(); // the landing stage may have made another theme the active one
      resize();
      modes.setActive(true);
      pins.setActive(true);
      blockSelection?.setActive(true);
      if (!running) {
        clock.getDelta();
        running = true;
        requestAnimationFrame(frame);
      }
    },
    hidden() {
      running = false;
      modes.setActive(false);
      pins.setActive(false);
      blockSelection?.setActive(false);
    },
    dispose() {
      running = false;
      modes.setActive(false);
      pins.dispose();
      blockSelection?.dispose();
      observer.disconnect();
      fpsReadout?.dispose();
      atmosphere.dispose();
      modes.dispose();
      routes?.dispose();
      controls.dispose();
      animator.skip(); // finishes any fade, which disposes its cloned materials
      removeWorld();
      scene.remove(placeholder);
      placeholder.traverse((object) => {
        (object as THREE.Mesh).geometry?.dispose();
        if ((object as THREE.Line).isLine) ((object as THREE.Line).material as THREE.Material).dispose(); // the grid's own; the ground's is the shared palette's
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
