import type * as THREE from "three";
import { FACADE_REPEAT_METRES, GROUND_TILE_METRES } from "./themes/textures";
import type { ShaderPatch } from "./nightWindows";

/**
 * Shader patches for Realistic's textures. Neither needs geometry UVs: both overwrite the map's `vMapUv`, which
 * `uv_vertex` has just written, from world-space coordinates. The three.js chunks they search for are in
 * `REALISTIC_ANCHORS`; a test checks they still exist in the installed three.js.
 */
export const REALISTIC_ANCHORS = {
  vertexPars: "#include <uv_pars_vertex>",
  vertexUv: "#include <uv_vertex>",
  fragmentPars: "#include <map_pars_fragment>",
  fragmentMap: "#include <map_fragment>",
} as const;

const f = (n: number) => n.toFixed(4);

const BUILDING_VERTEX_PARS = /* glsl */ `
varying float vRealRoof;
`;

/**
 * Mirrors wallCoords and groundCoords in wallGrid.ts: the same tangent, dot product and roof cut-off. A building mesh is
 * only translated on y, so the local `position` is world x and z, and the height above the base. Walls use the facade
 * texture over FACADE_REPEAT_METRES, roofs the roof texture over GROUND_TILE_METRES.roof.
 */
const BUILDING_VERTEX = /* glsl */ `
vec3 realN = normalize(normal);
float realRoof = step(0.5, abs(realN.y));
vec2 realNh = normalize(realN.xz + vec2(1e-6));
vec2 realTangent = vec2(-realNh.y, realNh.x);
vec2 realWall = vec2(dot(position.xz, realTangent), position.y) / vec2(${f(FACADE_REPEAT_METRES.u)}, ${f(FACADE_REPEAT_METRES.v)});
vec2 realFlat = position.xz / ${f(GROUND_TILE_METRES.roof)};
vRealRoof = realRoof;
vMapUv = mix(realWall, realFlat, realRoof);
`;

const BUILDING_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uRoof;
varying float vRealRoof;
`;

/** Both textures are sampled in uniform control flow (derivatives for the mip level) and mixed by the roof mask. */
const BUILDING_FRAGMENT = /* glsl */ `
vec4 realFacade = texture2D(map, vMapUv);
vec4 realRoofTexel = texture2D(uRoof, vMapUv);
diffuseColor *= mix(realFacade, realRoofTexel, vRealRoof);
`;

/** Textured building walls (`map`, the facade) and roofs (`uRoof`). The material must have `map` set. */
export function texturedBuildingPatch(roof: THREE.Texture): ShaderPatch {
  return {
    apply: (shader) => {
      shader.uniforms.uRoof = { value: roof };
      shader.vertexShader = shader.vertexShader
        .replace(REALISTIC_ANCHORS.vertexPars, `${REALISTIC_ANCHORS.vertexPars}\n${BUILDING_VERTEX_PARS}`)
        .replace(REALISTIC_ANCHORS.vertexUv, `${REALISTIC_ANCHORS.vertexUv}\n${BUILDING_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace(REALISTIC_ANCHORS.fragmentPars, `${REALISTIC_ANCHORS.fragmentPars}\n${BUILDING_FRAGMENT_PARS}`)
        .replace(REALISTIC_ANCHORS.fragmentMap, BUILDING_FRAGMENT);
    },
    key: "realistic-building",
  };
}

/**
 * Textured ground layers: the map is looked up by world x and z over `tile` metres. The vertex shader goes through
 * `modelMatrix` because layer meshes may be positioned. The material must have `map` set.
 */
export function groundTexturePatch(tile: number): ShaderPatch {
  return {
    apply: (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        REALISTIC_ANCHORS.vertexUv,
        `${REALISTIC_ANCHORS.vertexUv}\n  vMapUv = (modelMatrix * vec4(position, 1.0)).xz / ${f(tile)};`,
      );
    },
    key: `realistic-ground-${f(tile)}`,
  };
}
