import * as THREE from "three";
import { CELL_WIDTH, FLOOR_HEIGHT } from "./wallGrid";
import { nightClay } from "./themes/nightClay";

/** Shared by every patched material: the atmosphere drives them each frame (see `applyWindowUniforms`). */
export const WINDOW_UNIFORMS = {
  /** 0 (windows dark) to 1 (fully lit). */
  uNight: { value: 0 },
  /** Lit-window colour of real buildings. */
  uWarm: { value: new THREE.Color(nightClay.windowColors?.warm) },
  /** Lit-window colour of generated buildings. */
  uCool: { value: new THREE.Color(nightClay.windowColors?.cool) },
};

/** Share of wall cells whose window is lit. */
export const DENSITY_REAL = 0.25;
export const DENSITY_GENERATED = 0.15;
/** The window's rectangle inside a cell (local 0..1). */
export const WINDOW_RECT = { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.75 };

const HASH = { a: 12.9898, b: 78.233, c: 37.719, k: 43758.5453 };

/** JS twin of the shader's `windowHash` test (the GPU computes it in float32, so individual cells may differ). */
export function windowLit(cellX: number, cellY: number, plane: number, density: number): boolean {
  const s = Math.sin(cellX * HASH.a + cellY * HASH.b + plane * HASH.c) * HASH.k;
  return s - Math.floor(s) < density;
}

/** The three.js chunks the patch searches for. A test checks they still exist in the installed three.js. */
export const PATCH_ANCHORS = {
  vertexCommon: "#include <common>",
  vertexBegin: "#include <begin_vertex>",
  fragmentCommon: "#include <common>",
  fragmentEnd: "#include <opaque_fragment>",
} as const;

const f = (n: number) => n.toFixed(4);

const VERTEX_PARS = /* glsl */ `
varying vec3 vWinPos;
varying vec3 vWinNormal;
#ifndef GRE_BASE_LIFT
#define GRE_BASE_LIFT
attribute float baseLift;
#endif
`;

const VERTEX_MAIN = /* glsl */ `
vWinPos = vec3(position.x, position.y - baseLift, position.z); // height above the building's own base, not its chunk's
vWinNormal = normal;
`;

const fragmentPars = (density: number) => /* glsl */ `
varying vec3 vWinPos;
varying vec3 vWinNormal;
uniform float uNight;
uniform vec3 uWindowColor;

float windowHash(vec2 cell, float plane) {
  return fract(sin(dot(vec3(cell, plane), vec3(${HASH.a}, ${HASH.b}, ${HASH.c}))) * ${HASH.k});
}
float windowBand(float l, float a, float b, float w) {
  return smoothstep(a - w, a + w, l) - smoothstep(b - w, b + w, l);
}
// Mirrors wallCoords in wallGrid.ts: same tangent, same dot product, same roof cut-off.
float windowGlow() {
  // No early returns: fwidth must run in uniform control flow, so every mask is a float multiplied in at the end.
  vec3 n = normalize(vWinNormal);
  float wall = step(abs(n.y), 0.5);
  vec2 nh = normalize(n.xz + vec2(1e-6));
  vec2 tangent = vec2(-nh.y, nh.x);
  float u = dot(vWinPos.xz, tangent);
  float v = vWinPos.y;
  float aboveGround = step(0.5, v);
  vec2 cellPos = vec2(u / ${f(CELL_WIDTH)}, v / ${f(FLOOR_HEIGHT)});
  vec2 fw = fwidth(cellPos);
  float fwMax = max(fw.x, fw.y);
  vec2 cell = floor(cellPos);
  vec2 local = cellPos - cell;
  float plane = floor(dot(vWinPos.xz, nh) * 2.0);
  float density = ${f(density)};
  float w = max(fwMax * 0.5, 0.0005);
  float lit = step(windowHash(cell, plane), density);
  float crisp = lit * windowBand(local.x, ${f(WINDOW_RECT.x0)}, ${f(WINDOW_RECT.x1)}, w) * windowBand(local.y, ${f(WINDOW_RECT.y0)}, ${f(WINDOW_RECT.y1)}, w);
  // Far away a cell is under a pixel: show the average glow (density x window area x brightness) instead of a flickering rectangle.
  // A coarse hash over 4x4-cell blocks varies it between 0.4x and 1.6x, so a far city reads as a soft speckle.
  float block = 0.4 + 1.2 * windowHash(floor(cell / 4.0), plane + 101.0);
  float average = density * ${f((WINDOW_RECT.x1 - WINDOW_RECT.x0) * (WINDOW_RECT.y1 - WINDOW_RECT.y0))} * 2.0 * block;
  return wall * aboveGround * mix(crisp, average, smoothstep(0.3, 1.0, fwMax));
}
`;

const FRAGMENT_MAIN = /* glsl */ `
outgoingLight += uWindowColor * (windowGlow() * uNight);
`;

/** A change to a built-in material's shader, with the cache key of the program it produces. Several compose onto one material (`composePatches`). */
export interface ShaderPatch {
  apply: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  key: string;
}

/**
 * The patch that draws lit windows on walls, in the emissive position: added to `outgoingLight` just before
 * `opaque_fragment`, which both MeshBasicMaterial and MeshLambertMaterial run, so it shows where no light falls.
 * Real buildings use the warm colour, generated ones the cool one.
 */
export function windowsPatch({ generated }: { generated: boolean }): ShaderPatch {
  const density = generated ? DENSITY_GENERATED : DENSITY_REAL;
  return {
    apply: (shader) => {
      shader.uniforms.uNight = WINDOW_UNIFORMS.uNight;
      shader.uniforms.uWindowColor = generated ? WINDOW_UNIFORMS.uCool : WINDOW_UNIFORMS.uWarm;
      shader.vertexShader = shader.vertexShader
        .replace(PATCH_ANCHORS.vertexCommon, `${PATCH_ANCHORS.vertexCommon}\n${VERTEX_PARS}`)
        .replace(PATCH_ANCHORS.vertexBegin, `${PATCH_ANCHORS.vertexBegin}\n${VERTEX_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace(PATCH_ANCHORS.fragmentCommon, `${PATCH_ANCHORS.fragmentCommon}\n${fragmentPars(density)}`)
        .replace(PATCH_ANCHORS.fragmentEnd, `${FRAGMENT_MAIN}\n${PATCH_ANCHORS.fragmentEnd}`);
    },
    key: `windows-${generated ? "generated" : "real"}`,
  };
}

/**
 * Gives `material` one `onBeforeCompile` that runs every patch in order, and a cache key that joins theirs, so two
 * patches on one material never overwrite each other and differing combinations never share a program.
 */
export function composePatches(material: THREE.Material, ...patches: ShaderPatch[]): void {
  material.onBeforeCompile = (shader) => {
    for (const patch of patches) patch.apply(shader);
  };
  const key = patches.map((patch) => patch.key).join("+");
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
}

/** Makes `material` draw lit windows on its walls (see `windowsPatch`). */
export function patchWindows(material: THREE.Material, options: { generated: boolean }): void {
  composePatches(material, windowsPatch(options));
}

/** Sets the shared uniforms for a frame: how lit the windows are, and their colours. */
export function applyWindowUniforms(night: number, colors?: { warm: string; cool: string }): void {
  WINDOW_UNIFORMS.uNight.value = night;
  if (colors) {
    WINDOW_UNIFORMS.uWarm.value.set(colors.warm);
    WINDOW_UNIFORMS.uCool.value.set(colors.cool);
  }
}

/** The night value a theme calls for: always lit, following the time of day, or never. */
export function windowNight(mode: "always" | "night" | "never", timeNight: number): number {
  return mode === "always" ? 1 : mode === "night" ? timeNight : 0;
}
