import * as THREE from "three";
import type { ApiClient } from "../api/client";
import { prefersReducedMotion } from "../locations/flyTo";
import { Animator } from "../scene/buildAnimation";
import { buildWorld } from "../scene/buildWorld";
import { overview } from "../scene/framing";
import { changeBetween, FINAL_STEP, layersFor, pickSlot, STORY_LAYERS, type StoryLayer } from "./storySteps";

/** The turntable's speed, radians per second. */
const TURN_SPEED = 0.05;
const BACKGROUND = "#1b252d";

export type StageSlot = "hero" | "story";

export interface FeaturedStage {
  /** The story step to show while the canvas is in the story slot (the hero always shows the finished place). */
  setStep(step: number): void;
  /** Stops the loop and releases the WebGL context and the geometry. Safe to call twice. */
  dispose(): void;
}

export interface FeaturedStageOptions {
  api: ApiClient;
  areaId: string;
  /** The two places the one canvas moves between. The stage sets `data-stage="3d"` on each once it has a picture. */
  slots: Record<StageSlot, HTMLElement>;
  /** Called when a slot gets its first 3D picture, so the page can drop its 2D fallback. */
  onReady?: () => void;
}

/**
 * The landing page's 3D stage: one WebGL renderer for the whole page, turning slowly over the featured
 * place. Its canvas lives in whichever slot is more visible; the hero shows every layer, the story slot
 * the layers up to the active step. Throws when WebGL is unavailable, and rejects when the map data
 * can't be loaded; the caller keeps its 2D preview then.
 */
export async function createFeaturedStage({ api, areaId, slots, onReady }: FeaturedStageOptions): Promise<FeaturedStage> {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  let world: THREE.Group | undefined;
  let disposed = false;
  const release = () => {
    world?.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
  const data = await api.mapData(areaId).catch((error: unknown) => {
    release();
    throw error;
  });

  const stage = (() => {
    const reduced = prefersReducedMotion();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.className = "landing-stage-canvas";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    scene.add(new THREE.HemisphereLight("#ffffff", "#7a8b6f", 1.4));
    const sun = new THREE.DirectionalLight("#fff4e0", 1.6);
    sun.position.set(300, 500, 200);
    scene.add(sun);

    world = buildWorld(data);
    scene.add(world);
    const view = overview(new THREE.Box3().setFromObject(world));
    const camera = new THREE.PerspectiveCamera(45, 1, 1, view.far);
    camera.position.copy(view.position);
    const target = view.target;
    camera.lookAt(target);

    const animator = new Animator();
    if (reduced) animator.skip(); // layers appear and disappear at once

    const group = (layer: StoryLayer) => world!.getObjectByName(layer)!;
    /** The step whose layers are on screen now, so a change can be animated from it. */
    let shown: number | null = null;
    let step = FINAL_STEP;
    let slot: StageSlot | null = null;

    const apply = (to: number, animate: boolean) => {
      animator.reset(); // finish whatever is mid-animation, so the next change starts from a settled picture
      if (reduced) animator.skip();
      if (!animate || shown === null) {
        const visible = new Set<StoryLayer>(layersFor(to));
        for (const layer of STORY_LAYERS) group(layer).visible = visible.has(layer);
      } else {
        const change = changeBetween(shown, to);
        for (const layer of change.hide) group(layer).visible = false;
        for (const layer of change.animate) {
          const object = group(layer);
          object.visible = true;
          if (reduced) continue;
          if (layer === "buildings") void animator.rise(object.children as THREE.Mesh[]);
          else void animator.fadeIn([object]);
        }
      }
      shown = to;
    };

    const fit = () => {
      if (!slot) return;
      const host = slots[slot];
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const place = (next: StageSlot | null) => {
      if (next === slot) return;
      slot = next;
      if (!next) return;
      slots[next].appendChild(renderer.domElement);
      fit();
      // Moving to a slot restarts its picture without animation: the hero is whole, the story is at its step.
      apply(next === "hero" ? FINAL_STEP : step, false);
    };

    const ratios: Record<StageSlot, number> = { hero: 0, story: 0 };
    const intersections = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (Object.keys(slots) as StageSlot[]).find((k) => slots[k] === entry.target);
          if (key) ratios[key] = entry.intersectionRatio;
        }
        place(pickSlot(ratios, slot));
        schedule();
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    const resizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    for (const host of Object.values(slots)) {
      intersections.observe(host);
      resizes?.observe(host);
    }

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = 0;
      if (disposed || !slot || document.hidden) return;
      const delta = Math.min((now - last) / 1000, 0.1);
      last = now;
      animator.update(delta);
      if (!reduced) {
        const offset = camera.position.clone().sub(target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, TURN_SPEED * delta);
        camera.position.copy(target).add(offset);
        camera.lookAt(target);
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    // The loop runs only while the canvas is on screen and the tab is showing.
    function schedule() {
      if (disposed || frame || !slot || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
    const onVisibility = () => schedule();
    document.addEventListener("visibilitychange", onVisibility);

    onReady?.();
    for (const host of Object.values(slots)) host.dataset.stage = "3d";

    return {
      setStep(next: number) {
        const clamped = Math.min(Math.max(next, 0), FINAL_STEP);
        const previous = step;
        step = clamped;
        if (slot === "story" && clamped !== previous) apply(clamped, true);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(frame);
        intersections.disconnect();
        resizes?.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        for (const host of Object.values(slots)) delete host.dataset.stage;
        release();
      },
    } satisfies FeaturedStage;
  })();
  return stage;
}
