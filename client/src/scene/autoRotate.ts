export const IDLE_SECONDS = 5;
/** OrbitControls' autoRotateSpeed: 0.5 is one turn every two minutes when update() is given a delta. */
export const ROTATE_SPEED = 0.5;

export interface AutoRotate {
  /** The user's choice (the button). */
  readonly enabled: boolean;
  /** Turning it on rotates at once: no idle wait. */
  setEnabled(on: boolean): void;
  /** OrbitControls "start". */
  interactionStart(): void;
  /** OrbitControls "end": the idle clock starts here. */
  interactionEnd(): void;
  /** Whether the camera should rotate this frame. */
  update(delta: number, context: { fly: boolean; world: boolean; building: boolean }): boolean;
}

/** When the scene turns by itself: only while enabled, flying, with a finished world, and the user
 * has been idle for `IDLE_SECONDS`. Leaving walk mode or ending a build restarts the idle clock. */
export function createAutoRotate(initiallyEnabled: boolean): AutoRotate {
  let enabled = initiallyEnabled;
  let interacting = false;
  let idle = IDLE_SECONDS;
  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      idle = IDLE_SECONDS;
    },
    interactionStart() {
      interacting = true;
      idle = 0;
    },
    interactionEnd() {
      interacting = false;
      idle = 0;
    },
    update(delta, { fly, world, building }) {
      if (!fly || building) {
        idle = 0;
        return false;
      }
      if (interacting) return false;
      idle += delta;
      return enabled && world && idle >= IDLE_SECONDS;
    },
  };
}
