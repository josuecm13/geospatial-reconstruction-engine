import * as THREE from "three";

export const FADE_SECONDS = 0.6;
export const RISE_SECONDS = 0.8;
/** Gap between buildings rising in one ring... */
export const STAGGER_SECONDS = 0.02;
/** ...squeezed so that a ring of hundreds doesn't take longer than this to start its last building. */
export const MAX_STAGGER_TOTAL_SECONDS = 1.5;

export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3;

/** How far through an animation that starts after `delay` and lasts `duration`, from 0 to 1. */
export const progress = (elapsed: number, delay: number, duration: number): number => Math.min(Math.max((elapsed - delay) / duration, 0), 1);

/** When the `index`-th of `count` buildings starts rising. */
export const staggerDelay = (index: number, count: number): number =>
  index * Math.min(STAGGER_SECONDS, MAX_STAGGER_TOTAL_SECONDS / Math.max(count, 1));

/** How long a ring of `count` buildings takes from the first starting to the last finishing. */
export const riseDuration = (count: number): number => RISE_SECONDS + staggerDelay(Math.max(count - 1, 0), count);

interface Tween {
  duration: number;
  elapsed: number;
  apply(elapsed: number): void;
  /** Puts everything in its final state. */
  finish(): void;
  resolve(): void;
}

/**
 * The staged build's tweens: layers fading in and buildings rising. Call `update` every frame. `skip`
 * finishes everything pending at once, and anything started afterwards is instant.
 */
export class Animator {
  private readonly tweens = new Set<Tween>();
  private instant = false;

  get skipping(): boolean {
    return this.instant;
  }

  /** Starts the next build: animations play again. */
  reset(): void {
    this.skip();
    this.instant = false;
  }

  skip(): void {
    this.instant = true;
    for (const tween of [...this.tweens]) this.complete(tween);
  }

  /** Fades every mesh and line under `objects` (building edges included) from transparent to its own opacity, on cloned materials, so the shared ones stay untouched. */
  fadeIn(objects: THREE.Object3D[]): Promise<void> {
    if (this.instant) return Promise.resolve();
    const clones = new Map<THREE.Material, THREE.Material>();
    const meshes: { mesh: THREE.Mesh | THREE.LineSegments; original: THREE.Material }[] = [];
    for (const object of objects) {
      object.traverse((node) => {
        const mesh = node as THREE.Mesh | THREE.LineSegments;
        if (!(mesh as THREE.Mesh).isMesh && !(mesh as THREE.LineSegments).isLineSegments) return;
        if (Array.isArray(mesh.material)) return;
        const original = mesh.material as THREE.Material;
        let clone = clones.get(original);
        if (!clone) {
          clone = original.clone();
          clone.transparent = true;
          clone.opacity = 0;
          clones.set(original, clone);
        }
        mesh.material = clone;
        meshes.push({ mesh, original });
      });
    }
    return this.start({
      duration: FADE_SECONDS,
      apply: (elapsed) => {
        const eased = easeOutCubic(progress(elapsed, 0, FADE_SECONDS));
        for (const [original, clone] of clones) clone.opacity = original.opacity * eased;
      },
      finish: () => {
        for (const { mesh, original } of meshes) mesh.material = original;
        for (const clone of clones.values()) clone.dispose();
      },
    });
  }

  /** Raises each mesh from nothing to full height (`scale.y` 0 to 1), one after another. */
  rise(meshes: THREE.Mesh[]): Promise<void> {
    if (this.instant || !meshes.length) return Promise.resolve();
    const count = meshes.length;
    const set = (mesh: THREE.Mesh, amount: number) => {
      mesh.scale.y = amount;
      mesh.visible = amount > 0;
    };
    meshes.forEach((mesh) => set(mesh, 0));
    return this.start({
      duration: riseDuration(count),
      apply: (elapsed) => meshes.forEach((mesh, i) => set(mesh, easeOutCubic(progress(elapsed, staggerDelay(i, count), RISE_SECONDS)))),
      finish: () => meshes.forEach((mesh) => set(mesh, 1)),
    });
  }

  update(delta: number): void {
    for (const tween of [...this.tweens]) {
      tween.elapsed += delta;
      if (tween.elapsed >= tween.duration) this.complete(tween);
      else tween.apply(tween.elapsed);
    }
  }

  private start(parts: Pick<Tween, "duration" | "apply" | "finish">): Promise<void> {
    return new Promise((resolve) => {
      const tween: Tween = { ...parts, elapsed: 0, resolve };
      parts.apply(0);
      this.tweens.add(tween);
    });
  }

  private complete(tween: Tween): void {
    this.tweens.delete(tween);
    tween.finish();
    tween.resolve();
  }
}
