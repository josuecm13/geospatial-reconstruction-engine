import { CLIPPED } from "../state/selection";
import * as THREE from "three";
import type { ApiClient } from "../api/client";
import { prefersReducedMotion } from "../locations/flyTo";
import { createAtmosphere } from "../scene/atmosphere";
import { Animator } from "../scene/buildAnimation";
import { applyDetail } from "../scene/detailLevels";
import { buildWorld } from "../scene/buildWorld";
import { overview } from "../scene/framing";
import { initialPixelRatio } from "../scene/pixelRatio";
import { restyle, SCENE_BACKGROUND, setActiveTheme } from "../scene/palette";
import { DRONE_FOV, droneShot, dronePosition, type Footprint } from "./droneShot";
import { readLandingLook, STORY_LOOK, type LandingLook } from "./landingLook";
import { changeBetween, FINAL_STEP, hasGeneratedContext, heroStep, layersFor, pickSlot, STORY_LAYERS, type StoryLayer } from "./storySteps";

/** The story slot's turntable speed, radians per second. */
const TURN_SPEED = 0.05;

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
 * The landing page's 3D stage: one WebGL renderer for the whole page, drifting slowly over the featured
 * place. Each slot has its own look: the hero takes the site setting's, the story is always Night clay. Its canvas
 * lives in whichever slot is more visible; the hero shows the finished place from a low drone shot (with the generated layer when it has one), the story slot
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
  // The look never fails (it falls back to Night clay at midday), so only the map data can stop the stage.
  const [data, heroLook] = await Promise.all([api.mapData(areaId, CLIPPED), readLandingLook(api)]).catch((error: unknown) => {
    release();
    throw error;
  });

  const stage = (() => {
    const reduced = prefersReducedMotion();
    renderer.setPixelRatio(initialPixelRatio(window.devicePixelRatio));
    renderer.domElement.className = "landing-stage-canvas";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SCENE_BACKGROUND);

    // The world is built in the hero's look; `place` switches it to the slot's look when that differs.
    setActiveTheme(heroLook.theme);
    world = buildWorld(data);
    scene.add(world);
    restyle(scene);
    const atmosphere = createAtmosphere(scene, renderer);
    atmosphere.setTheme(heroLook.theme);
    atmosphere.setTime(heroLook.time, { animate: false });
    const looks: Record<StageSlot, LandingLook> = { hero: heroLook, story: STORY_LOOK };
    let applied = heroLook;
    const box = new THREE.Box3().setFromObject(world);
    const view = overview(box);
    // The hero's drone shot: low across the streets toward the dense centre of the buildings, on the terrain when there is some.
    const footprints: Footprint[] = [];
    for (const name of ["buildings", "generated"]) {
      for (const child of world.getObjectByName(name)?.children ?? []) {
        // A chunk records each of its buildings' centre and height (batching.ts), as x, z, height.
        const centres = (child.userData.centres as number[] | undefined) ?? [];
        for (let i = 0; i + 2 < centres.length; i += 3) footprints.push({ x: child.position.x + centres[i], z: child.position.z + centres[i + 1], height: centres[i + 2] });
      }
    }
    const terrain = world.userData.terrain as { hasGround?: boolean; heightAtLocal(x: number, z: number): number } | undefined;
    const drone = droneShot(box, footprints, terrain?.hasGround ? (x, z) => terrain.heightAtLocal(x, z) : undefined);
    const framings: Record<StageSlot, { fov: number; far: number; target: THREE.Vector3 }> = {
      hero: { fov: DRONE_FOV, far: drone.far, target: drone.target },
      story: { fov: 45, far: view.far, target: view.target },
    };
    const camera = new THREE.PerspectiveCamera(45, 1, 1, view.far);
    let target = view.target;
    /** Seconds the camera has drifted in the hero, so each visit to it starts from the shot's own frame. */
    let drift = 0;
    const frameFor = (next: StageSlot) => {
      const framing = framings[next];
      target = framing.target;
      camera.fov = framing.fov;
      camera.far = framing.far;
      camera.updateProjectionMatrix();
      if (next === "hero") {
        drift = 0;
        camera.position.copy(drone.position);
      } else {
        camera.position.copy(view.position);
      }
      camera.lookAt(target);
    };
    frameFor("story");

    const animator = new Animator();
    if (reduced) animator.skip(); // layers appear and disappear at once

    /** Build animations still running, so the atmosphere holds its shadows still while they do. */
    let animating = 0;
    const track = (done: Promise<unknown>) => {
      animating += 1;
      void done.finally(() => (animating -= 1));
    };

    const group = (layer: StoryLayer) => world!.getObjectByName(layer)!;
    /** The step whose layers are on screen now, so a change can be animated from it. */
    let shown: number | null = null;
    let step = FINAL_STEP;
    const hero = heroStep(hasGeneratedContext(data));
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
          if (layer === "buildings" || layer === "generated") track(animator.rise(object.children as THREE.Mesh[]));
          else track(animator.fadeIn([object]));
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

    /** Switches the whole scene to the slot's look: materials, sky, lights, fog and shadows. A no-op when it is already showing. */
    const applyLook = (next: StageSlot) => {
      const wanted = looks[next];
      if (wanted.theme.id === applied.theme.id && wanted.time === applied.time) return;
      applied = wanted;
      // Settle any build animation first: a fade holds cloned materials that restyle would otherwise lose.
      animator.reset();
      if (reduced) animator.skip();
      setActiveTheme(wanted.theme);
      restyle(scene);
      atmosphere.setTheme(wanted.theme);
      atmosphere.setTime(wanted.time, { animate: false });
    };

    const place = (next: StageSlot | null) => {
      if (next === slot) return;
      slot = next;
      if (!next) return;
      slots[next].appendChild(renderer.domElement);
      frameFor(next);
      applyLook(next);
      fit();
      // Moving to a slot restarts its picture without animation: the hero is whole, the story is at its step.
      apply(next === "hero" ? hero : step, false);
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
      if (!reduced && slot === "hero") {
        drift += delta;
        camera.position.copy(dronePosition(drone, drift));
        camera.lookAt(target);
      } else if (!reduced) {
        const offset = camera.position.clone().sub(target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, TURN_SPEED * delta);
        camera.position.copy(target).add(offset);
        camera.lookAt(target);
      }
      if (applyDetail(world!, camera, slots[slot].clientHeight)) atmosphere.invalidateShadows();
      atmosphere.update(delta, camera, target, { buildAnimating: animating > 0 });
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
        animator.skip(); // finishes any fade, which disposes its cloned materials
        atmosphere.dispose();
        release();
      },
    } satisfies FeaturedStage;
  })();
  return stage;
}
