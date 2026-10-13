import * as THREE from "three";
import type { BlockFeedback, BlockProperties } from "../api/types";
import { blockAt } from "./blockOutline";
import { createBlockPanel, type BlockFeedbackApi } from "./blockPanel";
import { redrawBlockOutlines } from "./buildWorld";
import type { Local } from "./projection";

const CLICK_SLOP_PIXELS = 5;

/** Groups a click's ray can land on, as for routes and the pin: the ground, the area features and the roads, never buildings. */
const PICKABLE_GROUPS = ["ground", "area_features", "roads"];

/** One entry of a world's `userData.blockIndex` (buildWorld.ts). */
interface IndexedBlock {
  id: string;
  polygons: Local[][][];
  properties: BlockProperties;
}

export interface BlockSelection {
  /** A new world (or `undefined`) clears the selection. */
  setWorld(world: THREE.Object3D | undefined): void;
  /** Blocks can only be picked while "Show blocks" is on; turning it off deselects. */
  setEnabled(enabled: boolean): void;
  /** Escape only acts while the scene is the visible tab. */
  setActive(active: boolean): void;
  /** Removes the `window` listener and the panel; call when the page is left. */
  dispose(): void;
}

/**
 * Selecting a block in the scene. With "Show blocks" on, a click (a press and release that barely moved, so
 * orbiting by dragging doesn't pick) on the ground finds the block under the pointer: the ray goes to the
 * ground, and the block is the one whose polygon contains that point, so even a block with no buildable area
 * (a median, a sliver) can be picked, and buildings in front don't get in the way. The block's outline turns
 * solid and highlighted, and the panel (blockPanel.ts) opens. Escape, the panel's close button, or a click
 * on no block deselects. `canSelect` lets the host turn picking off (while walking, or while Set point or
 * Route have the click).
 */
export function createBlockSelection(camera: THREE.Camera, canvas: HTMLElement, container: HTMLElement, api: BlockFeedbackApi, canSelect: () => boolean): BlockSelection {
  const raycaster = new THREE.Raycaster();
  let world: THREE.Object3D | undefined;
  let enabled = false;
  let active = false;
  let selected: string | null = null;

  const index = (): IndexedBlock[] => world?.userData.blockIndex ?? [];

  /** Every outline of the world is drawn in the material of its kind (merged per cell, buildWorld.ts), the selected block's as an object of its own in the highlighted one. */
  const paint = () => {
    if (world?.userData.blockOutlines) redrawBlockOutlines(world, selected);
  };

  const panel = createBlockPanel(
    container,
    api,
    (blockId, feedback: BlockFeedback | null) => {
      const block = index().find((entry) => entry.id === blockId);
      if (block) block.properties = { ...block.properties, feedback };
    },
    () => select(null),
  );

  function select(id: string | null): void {
    selected = id;
    paint();
    const block = id ? index().find((entry) => entry.id === id) : undefined;
    panel.show(block ? { id: block.id, properties: block.properties } : null);
  }

  const pickGround = (clientX: number, clientY: number): { x: number; z: number } | null => {
    if (!world) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
    const targets = PICKABLE_GROUPS.flatMap((name) => world!.getObjectByName(name)?.children ?? []);
    const [hit] = raycaster.intersectObjects(targets, true);
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  };

  let down: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    const start = down;
    down = null;
    if (!enabled || !start || event.button !== 0 || !canSelect()) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PIXELS) return;
    const ground = pickGround(event.clientX, event.clientY);
    select(ground ? blockAt(index(), ground.x, ground.z) : null);
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (active && event.key === "Escape" && selected) select(null);
  };
  window.addEventListener("keydown", onKeyDown);

  return {
    setWorld(next) {
      world = next;
      select(null);
    },
    setEnabled(value) {
      enabled = value;
      if (!enabled) select(null);
    },
    setActive(value) {
      active = value;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      panel.dispose();
    },
  };
}
