import * as THREE from "three";
import { LAYER_ORDER } from "./buildWorld";
import { MATERIALS } from "./palette";
import { pinOnTerrain, type Vec3 } from "./pinPoint";
import { shadeGeometry } from "./shading";
import { flatTerrain, type Terrain } from "./terrain";

const CLICK_SLOP_PIXELS = 5;
const MARKER_HEIGHT = 6;
const RING_INNER = 3;
const RING_OUTER = 4;
/** The ring floats this far above the ground so it doesn't z-fight it. */
const RING_LIFT = 0.15;

/** Groups a click can land on, as for routes: the ground, the area features and the roads, never buildings. */
const PICKABLE_GROUPS = ["ground", "area_features", "roads"];

export interface PinLayer {
  /** A new world (or `undefined`) clears the pin, without calling `onChange`. */
  setWorld(world: THREE.Object3D | undefined): void;
  /** Drops the pin at local (x, z), on the terrain, and calls `onChange`. */
  set(x: number, z: number): void;
  /** Removes the pin and calls `onChange(null)`. */
  clear(): void;
  /** Disarms the tool (the pressed state follows). */
  disarm(): void;
  /** The `P` shortcut only acts while the scene is the visible tab. */
  setActive(active: boolean): void;
  /** Removes the `window` listener; call when the page is left. */
  dispose(): void;
}

/**
 * The "Set point" tool of the scene. With the tool on (button or `P`), a click on the ground drops
 * the pin; a double-click on the ground drops it at any time. The marker (a small cone and a ground
 * ring) lives in its own group in `scene`, outside the world: it is never raycast by the picking
 * (which looks only at the world's ground, area features and roads) and never part of the glTF export
 * (which exports the world). It works in fly and walk mode alike: with the pointer locked (walking) the
 * pin goes where the crosshair, the screen centre, points.
 */
export function createPinLayer(
  scene: THREE.Scene,
  camera: THREE.Camera,
  canvas: HTMLElement,
  toolbar: HTMLElement,
  onChange: (pin: Vec3 | null) => void,
  /** Called when the tool is armed, so the host can disarm the tools it excludes (the Route tool). */
  onArm: () => void = () => {},
): PinLayer {
  const root = Object.assign(new THREE.Group(), { name: "pin" });
  root.visible = false;
  scene.add(root);
  const cone = new THREE.Mesh(shadeGeometry(new THREE.ConeGeometry(1.2, MARKER_HEIGHT, 12).rotateX(Math.PI)), MATERIALS.pin);
  cone.position.y = MARKER_HEIGHT / 2;
  const ring = new THREE.Mesh(shadeGeometry(new THREE.RingGeometry(RING_INNER, RING_OUTER, 32).rotateX(-Math.PI / 2)), MATERIALS.pinRing);
  ring.position.y = RING_LIFT;
  ring.renderOrder = LAYER_ORDER.blocks + 1;
  root.add(cone, ring);

  const tool = Object.assign(document.createElement("button"), { className: "scene-pin", type: "button", textContent: "Set point", title: "Set point (P)", hidden: true });
  const reset = Object.assign(document.createElement("button"), { className: "scene-pin", type: "button", textContent: "Reset to centre", hidden: true });
  toolbar.append(tool, reset);

  const raycaster = new THREE.Raycaster();
  let world: THREE.Object3D | undefined;
  let terrain: Terrain = flatTerrain();
  let active = false;
  let armed = false;

  const setArmed = (value: boolean) => {
    armed = value;
    showTool();
    if (armed) onArm();
  };
  const showTool = () => {
    tool.setAttribute("aria-pressed", String(armed));
    canvas.style.cursor = armed ? "crosshair" : "";
  };
  showTool();

  /** Local (x, z) of the ground under a pointer position, or null when nothing pickable is there. */
  const pickGround = (clientX: number, clientY: number): { x: number; z: number } | null => {
    if (!world) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // While walking the mouse is locked and its position is meaningless: the crosshair is the screen centre.
    const ndc =
      document.pointerLockElement === canvas
        ? new THREE.Vector2(0, 0)
        : new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets = PICKABLE_GROUPS.flatMap((name) => world!.getObjectByName(name)?.children ?? []);
    const [hit] = raycaster.intersectObjects(targets, true);
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  };

  const layer: PinLayer = {
    setWorld(next) {
      world = next;
      terrain = next?.userData.terrain ?? flatTerrain();
      root.visible = false;
      armed = false;
      showTool();
      tool.hidden = !next;
      reset.hidden = true;
    },
    set(x, z) {
      const pin = pinOnTerrain(terrain, x, z);
      root.position.set(pin.x, pin.y, pin.z);
      root.visible = true;
      reset.hidden = false;
      onChange(pin);
    },
    clear() {
      root.visible = false;
      reset.hidden = true;
      onChange(null);
    },
    disarm() {
      armed = false;
      showTool();
    },
    setActive(value) {
      active = value;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      scene.remove(root);
      cone.geometry.dispose();
      ring.geometry.dispose();
    },
  };

  let down: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    const start = down;
    down = null;
    if (!armed || !start || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PIXELS) return;
    const ground = pickGround(event.clientX, event.clientY);
    if (ground) layer.set(ground.x, ground.z);
  });
  canvas.addEventListener("dblclick", (event) => {
    const ground = pickGround(event.clientX, event.clientY);
    if (ground) layer.set(ground.x, ground.z);
  });
  tool.addEventListener("click", () => setArmed(!armed));
  reset.addEventListener("click", () => layer.clear());
  const onKeyDown = (event: KeyboardEvent) => {
    if (!active || event.code !== "KeyP" || event.ctrlKey || event.metaKey || event.altKey || tool.hidden) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
    setArmed(!armed);
  };
  window.addEventListener("keydown", onKeyDown);

  return layer;
}
