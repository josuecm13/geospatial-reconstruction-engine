import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { buildFootprintIndex, nearestRoadStart, resolveMove, type FootprintIndex, type Point } from "./collision";

export type CameraMode = "fly" | "walk";

export const EYE_HEIGHT = 1.7;
export const WALK_SPEED = 1.4;
export const RUN_SPEED = 4;

const HELP = "WASD to move · Shift to run · Esc to release the mouse";
const FORWARD = new Set(["KeyW", "ArrowUp"]);
const BACK = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);

export interface CameraModes {
  readonly mode: CameraMode;
  /** Switches between fly and walk. Does nothing while there is no world to walk in. */
  toggle(): void;
  /** Call each frame with the time since the last one, in seconds. */
  update(delta: number): void;
  /** Called when a world is loaded (or cleared with `undefined`); a walk in the old world ends. */
  setWorld(world: THREE.Object3D | undefined): void;
  /** Keyboard shortcuts only act while the scene is the visible tab. */
  setActive(active: boolean): void;
  /** Removes the `window` and `document` listeners; call when the page is left. */
  dispose(): void;
}

/** Fly (the orbit controls) and walk (first person on the ground, stopped by building walls),
 * with one toggle button and the `V` key. The button is appended to `toolbar` and the help overlay
 * to `container`. */
export function createCameraModes(
  camera: THREE.PerspectiveCamera,
  orbit: OrbitControls,
  canvas: HTMLElement,
  container: HTMLElement,
  toolbar: HTMLElement = container,
): CameraModes {
  const look = new PointerLockControls(camera, canvas);
  const button = Object.assign(document.createElement("button"), { className: "scene-mode", type: "button", textContent: "Walk", hidden: true });
  const help = Object.assign(document.createElement("div"), { className: "scene-help", textContent: HELP, hidden: true });
  toolbar.appendChild(button);
  container.appendChild(help);

  let mode: CameraMode = "fly";
  let world: THREE.Object3D | undefined;
  let index: FootprintIndex | undefined;
  let active = false;
  const saved = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  const held = new Set<string>();

  const enterWalk = () => {
    if (!world) return;
    saved.position.copy(camera.position);
    saved.target.copy(orbit.target);
    const center = new THREE.Box3().setFromObject(world).getCenter(new THREE.Vector3());
    const start = nearestRoadStart(world.userData.roadOutlines ?? [], { x: center.x, z: center.z });
    mode = "walk";
    orbit.enabled = false;
    camera.position.set(start.x, EYE_HEIGHT, start.z);
    camera.lookAt(start.x, EYE_HEIGHT, start.z - 1); // north is -z
    button.textContent = "Fly";
    help.hidden = false;
  };

  const enterFly = () => {
    mode = "fly";
    held.clear();
    if (look.isLocked) look.unlock();
    camera.position.copy(saved.position);
    orbit.target.copy(saved.target);
    orbit.enabled = true;
    orbit.update();
    button.textContent = "Walk";
    help.hidden = true;
  };

  const toggle = () => (mode === "fly" ? enterWalk() : enterFly());
  button.addEventListener("click", toggle);
  canvas.addEventListener("click", () => {
    if (mode === "walk" && !look.isLocked) look.lock();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (!active || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
    if (event.code === "KeyV") toggle();
    else if (mode === "walk") {
      held.add(event.code);
      if (event.code.startsWith("Arrow")) event.preventDefault();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => held.delete(event.code);
  const onBlur = () => held.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  const anyHeld = (codes: Set<string>) => [...codes].some((code) => held.has(code));

  return {
    get mode() {
      return mode;
    },
    toggle,
    update(delta) {
      if (mode !== "walk") return;
      const forward = Number(anyHeld(FORWARD)) - Number(anyHeld(BACK));
      const strafe = Number(anyHeld(RIGHT)) - Number(anyHeld(LEFT));
      if (forward || strafe) {
        const heading = camera.getWorldDirection(new THREE.Vector3());
        heading.y = 0;
        heading.normalize();
        const speed = (held.has("ShiftLeft") || held.has("ShiftRight") ? RUN_SPEED : WALK_SPEED) * delta;
        // Right of the heading on the ground plane (y up): (-z, x) rotated.
        const dx = (heading.x * forward + -heading.z * strafe) * speed;
        const dz = (heading.z * forward + heading.x * strafe) * speed;
        const from: Point = { x: camera.position.x, z: camera.position.z };
        const next = { x: from.x + dx, z: from.z + dz };
        const resolved = index ? resolveMove(index, from, next) : next;
        camera.position.x = resolved.x;
        camera.position.z = resolved.z;
      }
      camera.position.y = EYE_HEIGHT;
    },
    setWorld(next) {
      if (mode === "walk") enterFly();
      world = next;
      index = next ? buildFootprintIndex(next.userData.footprints ?? []) : undefined;
      button.hidden = !next;
    },
    setActive(value) {
      active = value;
      if (!value) {
        held.clear();
        if (look.isLocked) look.unlock();
      }
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      look.dispose();
      held.clear();
    },
  };
}
