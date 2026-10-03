import * as THREE from "three";

/** Whether the next world gets the overview camera, or keeps the user's view after a staged build
 * they moved in. */
export interface FramingPolicy {
  /** A staged build began. */
  stagedStarted(): void;
  /** The user moved the camera (OrbitControls "start"); ignored unless a staged build is pending. */
  userMoved(): void;
  /** The build was abandoned, or the scene was cleared: the next world is framed. */
  reset(): void;
  /** Called by `setWorld`: true to frame. Consumes the staged state either way. */
  shouldFrame(): boolean;
}

export function createFramingPolicy(): FramingPolicy {
  let staged = false;
  let moved = false;
  return {
    stagedStarted() {
      staged = true;
      moved = false;
    },
    userMoved() {
      if (staged) moved = true;
    },
    reset() {
      staged = false;
      moved = false;
    },
    shouldFrame() {
      const keep = staged && moved;
      staged = false;
      moved = false;
      return !keep;
    },
  };
}

/** The overview of a box: the box centre as the target, the camera raised and pulled back, and a
 * far plane that fits it. */
export function overview(box: THREE.Box3): { target: THREE.Vector3; position: THREE.Vector3; far: number } {
  const target = box.getCenter(new THREE.Vector3());
  const size = Math.max(box.getSize(new THREE.Vector3()).length(), 50);
  return {
    target,
    position: new THREE.Vector3(target.x, target.y + size * 0.6, target.z + size * 0.7),
    far: Math.max(5000, size * 10),
  };
}

/** The overview of a flat `width` x `height` metre rectangle centred on the projection origin. */
export function rectangleOverview(width: number, height: number) {
  const half = new THREE.Vector3(width / 2, 0, height / 2);
  return overview(new THREE.Box3(half.clone().negate(), half));
}
