import * as THREE from "three";
import { fitShadow, fitStands, SHADOW_MAP_SIZE, shadowHalfSize, shadowsOn } from "./shadowFit";
import { applyWindowUniforms, windowNight } from "./nightWindows";
import { createSkyMaterial } from "./themes/sky";
import { blendLighting, blendSky, LIGHTING, type Lighting, type Vec3 } from "./themes/timeOfDay";
import type { Sky, Theme, TimeOfDay } from "./themes/types";

/** How long a change of time of day takes to play. */
export const TRANSITION_SECONDS = 1.5;
export { SHADOW_MAP_SIZE };
/** The dome's radius, as a share of the camera's far plane. */
const DOME_RADIUS = 0.9;
/** Fog stays inside the dome: it ends at this share of the camera's far plane, and starts no later than 0.4 of where it ends. */
const FOG_FAR = 0.95;

/** What a theme that doesn't follow the sun has instead of lighting: no light at all (its materials are unlit). */
const UNLIT: Lighting = { ...LIGHTING.midday, sunIntensity: 0, hemisphereIntensity: 0, night: 0 };

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Look {
  lighting: Lighting;
  sky: Sky;
}

export interface Atmosphere {
  /** Switches the look at once: the theme's sky, fog and lights, and the shadows on or off. */
  setTheme(theme: Theme): void;
  /** Moves to a time of day, blending over 1.5 s with an ease, or at once. Nothing visible changes in a theme that doesn't follow the sun. */
  setTime(time: TimeOfDay, options: { animate: boolean }): void;
  /** Once per frame, before rendering. `target` is the orbit target; `buildAnimating` keeps the shadows redrawn while buildings rise. */
  update(deltaSeconds: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3, options: { buildAnimating: boolean }): void;
  /** The current night value, 0 by day and 1 at night, blended while the time changes. */
  night(): number;
  /** Marks the shadow map out of date (a world was loaded, a mesh added, the theme changed). */
  invalidateShadows(): void;
  /** How many times the shadow map has been asked to redraw since creation (the `?fps` readout watches it). */
  shadowRedraws(): number;
  /** Whether the sun casts shadows now: false in a theme that doesn't follow the sun, and while the camera is past `SHADOW_OFF_DISTANCE` (the lights stay on). */
  shadowsOn(): boolean;
  dispose(): void;
}

/**
 * The sky dome, the sun and the sky light, the fog and the shadows. In a theme that follows the sun the lights follow the
 * time of day and the sun casts shadows; in the others the lights are off and the dome shows the theme's fixed sky.
 */
export function createAtmosphere(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Atmosphere {
  const skyMaterial = createSkyMaterial();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial);
  dome.name = "sky";
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  dome.raycast = () => {}; // never picked

  const sun = new THREE.DirectionalLight();
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.autoUpdate = false; // redrawn when `dirty`, not every frame
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  const hemisphere = new THREE.HemisphereLight();
  scene.add(dome, sun, sun.target, hemisphere);
  renderer.shadowMap.type = THREE.PCFShadowMap;

  let theme: Theme | undefined;
  let time: TimeOfDay = "midday";
  let current: Look | undefined; // set by `setTheme`, which runs first
  let from!: Look; // the look a transition leaves
  let to!: Look; // the look the theme and time call for
  let progress = 1; // 1: not in transition
  let fog: THREE.Fog | null = null;
  let dirty = true;
  let redraws = 0;
  let shadowing = true; // false while the camera is too far for the shadow map's texels (`shadowsOn`)
  let lastSun: Vec3 | undefined;
  let lastHalfSize = 0;
  let lastTarget: Vec3 | undefined; // the target the box was last fitted to

  const lookFor = (forTheme: Theme, at: TimeOfDay): Look =>
    forTheme.followsSun ? { lighting: LIGHTING[at], sky: forTheme.skies?.[at] ?? forTheme.sky } : { lighting: UNLIT, sky: forTheme.sky };

  const apply = (look: Look) => {
    current = look;
    const { lighting, sky } = look;
    const following = !!theme?.followsSun;
    sun.visible = hemisphere.visible = following;
    sun.castShadow = following && shadowing;
    renderer.shadowMap.enabled = following && shadowing;
    sun.color.set(lighting.sunColor);
    sun.intensity = lighting.sunIntensity;
    hemisphere.color.set(lighting.skyColor);
    hemisphere.groundColor.set(lighting.groundColor);
    hemisphere.intensity = lighting.hemisphereIntensity;
    const uniforms = skyMaterial.uniforms;
    uniforms.zenith.value.set(sky.zenith);
    uniforms.horizon.value.set(sky.horizon);
    uniforms.below.value.set(sky.below);
    uniforms.sunDirection.value.set(lighting.sunDirection.x, lighting.sunDirection.y, lighting.sunDirection.z);
    uniforms.sunColor.value.set(lighting.sunColor);
    uniforms.sunStrength.value = following ? 1 : 0;
    uniforms.night.value = lighting.night;
    // The frame before the dome draws, and the fog, both match the horizon.
    if (scene.background instanceof THREE.Color) scene.background.set(sky.horizon);
    else scene.background = new THREE.Color(sky.horizon);
    fog?.color.set(sky.horizon);
    if (theme) applyWindowUniforms(windowNight(theme.windows, lighting.night), theme.windowColors);
  };

  return {
    setTheme(next) {
      theme = next;
      fog = next.fog ? new THREE.Fog(next.fog.color, next.fog.near, next.fog.far) : null;
      scene.fog = fog;
      progress = 1;
      from = to = lookFor(next, time);
      apply(to);
      dirty = true;
    },
    setTime(next, { animate }) {
      time = next;
      if (!theme?.followsSun) return;
      to = lookFor(theme, next);
      if (!animate) {
        progress = 1;
        from = to;
        apply(to);
      } else {
        from = current ?? to;
        progress = 0;
      }
      dirty = true;
    },
    update(delta, camera, target, { buildAnimating }) {
      if (progress < 1) {
        progress = Math.min(1, progress + delta / TRANSITION_SECONDS);
        const t = easeInOut(progress);
        apply({ lighting: blendLighting(from.lighting, to.lighting, t), sky: blendSky(from.sky, to.sky, t) });
      }
      dome.position.copy(camera.position);
      dome.scale.setScalar(DOME_RADIUS * camera.far);
      if (fog && theme?.fog) {
        fog.far = Math.min(theme.fog.far, camera.far * FOG_FAR);
        fog.near = Math.min(theme.fog.near, fog.far * 0.4);
      }
      if (!theme?.followsSun) return;
      const direction = (current ?? to).lighting.sunDirection;
      const distanceToTarget = camera.position.distanceTo(target);
      // Far from the target the box is capped, its texels are metres wide and the pass is wasted: shadows go off (the lights stay) and, coming back, refit and redraw.
      const wanted = shadowsOn(distanceToTarget, shadowing);
      if (wanted !== shadowing) {
        shadowing = wanted;
        sun.castShadow = renderer.shadowMap.enabled = wanted;
        lastSun = undefined; // the box is refitted on the way back
        dirty = true;
      }
      if (!shadowing) return;
      // A target that has only drifted a little keeps the last fit, and so the shadow map: a refit snaps to a new texel grid and redraws it.
      const stands =
        !!lastSun &&
        !!lastTarget &&
        direction.x === lastSun.x &&
        direction.y === lastSun.y &&
        direction.z === lastSun.z &&
        shadowHalfSize(distanceToTarget) === lastHalfSize &&
        fitStands(target, lastTarget, lastHalfSize);
      const moved = !stands;
      if (moved) {
        const { centre, halfSize } = fitShadow(target, distanceToTarget, direction, SHADOW_MAP_SIZE);
        lastSun = direction;
        lastHalfSize = halfSize;
        lastTarget = { x: target.x, y: target.y, z: target.z };
        // The light sits far enough along the sun's direction to see everything in the box, and looks at its centre.
        const distance = halfSize + 800;
        sun.target.position.set(centre.x, centre.y, centre.z);
        sun.position.set(centre.x + direction.x * distance, centre.y + direction.y * distance, centre.z + direction.z * distance);
        const shadowCamera = sun.shadow.camera;
        shadowCamera.left = shadowCamera.bottom = -halfSize;
        shadowCamera.right = shadowCamera.top = halfSize;
        shadowCamera.near = 1;
        shadowCamera.far = distance * 2;
        shadowCamera.updateProjectionMatrix();
        sun.target.updateMatrixWorld();
      }
      if (moved || dirty || buildAnimating) {
        sun.shadow.needsUpdate = true;
        redraws++;
        dirty = false;
      }
    },
    night: () => current?.lighting.night ?? 0,
    shadowRedraws: () => redraws,
    shadowsOn: () => !!theme?.followsSun && shadowing,
    invalidateShadows() {
      dirty = true;
    },
    dispose() {
      scene.remove(dome, sun, sun.target, hemisphere);
      dome.geometry.dispose();
      skyMaterial.dispose();
      sun.shadow.dispose();
      renderer.shadowMap.enabled = false;
      if (scene.fog === fog) scene.fog = null;
    },
  };
}
