import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { materialsFor } from "./palette";
import { composePatches, windowsPatch } from "./nightWindows";
import { REALISTIC_ANCHORS } from "./realisticShaders";
import { THEMES, themeById } from "./themes";
import { lightClay } from "./themes/lightClay";
import { nightClay } from "./themes/nightClay";
import { realistic } from "./themes/realistic";
import { createRealisticTextures, textureBytes } from "./themes/textures";

const lambertSource = () =>
  readFileSync(fileURLToPath(new URL("../../node_modules/three/src/renderers/shaders/ShaderLib/meshlambert.glsl.js", import.meta.url)), "utf8");

/** A stand-in for what three.js hands `onBeforeCompile`: the Lambert shader sources, with their `#include`s unexpanded. */
const fakeShader = () =>
  ({
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    uniforms: {} as Record<string, THREE.IUniform>,
  }) as unknown as THREE.WebGLProgramParametersWithUniforms;

const BUILDINGS = ["buildingMeasured", "buildingDefaulted", "buildingGenerated"] as const;
const TEXTURED_GROUND = ["roadNormal", "roadWide", "roadNarrow", "green", "forest", "water"] as const;
const UNTEXTURED_GROUND = ["ground", "farmland", "cemetery", "railway", "industrial"] as const;

describe("the Realistic theme", () => {
  it("is listed after Light clay, lit, following the sun, with night windows and a sky for every time", () => {
    expect(THEMES.indexOf(realistic)).toBe(THEMES.indexOf(lightClay) + 1);
    expect(themeById("realistic")).toBe(realistic);
    expect(realistic).toMatchObject({ mode: "lit", followsSun: true, windows: "night" });
    expect(Object.keys(realistic.skies ?? {}).sort()).toEqual(["dawn", "golden-hour", "midday", "night"]);
    expect(realistic.windowColors).toBeDefined();
  });

  it("keeps its texture set within 1 MB", () => {
    expect(realistic.textures).toBeDefined();
    expect(textureBytes(createRealisticTextures(realistic.textures!.colors))).toBeLessThanOrEqual(1024 * 1024);
  });

  it("gives buildings and the textured ground layers a map, and leaves the other ground plain", () => {
    const set = materialsFor(realistic);
    for (const key of BUILDINGS) {
      const material = set[key] as THREE.MeshLambertMaterial;
      expect(material.isMeshLambertMaterial, key).toBe(true);
      expect(material.map, key).toBeTruthy();
    }
    for (const key of TEXTURED_GROUND) expect((set[key] as THREE.MeshLambertMaterial).map, key).toBeTruthy();
    for (const key of UNTEXTURED_GROUND) expect((set[key] as THREE.MeshLambertMaterial).map, key).toBeFalsy();
  });

  it("tints generated buildings cooler than measured ones", () => {
    const set = materialsFor(realistic);
    const measured = (set.buildingMeasured as THREE.MeshLambertMaterial).color;
    const generated = (set.buildingGenerated as THREE.MeshLambertMaterial).color;
    expect(generated.b - generated.r).toBeGreaterThan(measured.b - measured.r);
  });

  it("keeps the textures sRGB and nearest-filtered, so colours aren't washed out and pixels stay crisp", () => {
    const { map } = materialsFor(realistic).roadNormal as THREE.MeshLambertMaterial;
    expect(map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(map!.magFilter).toBe(THREE.NearestFilter);
  });

  it("gives Night clay and Light clay no maps", () => {
    for (const theme of [nightClay, lightClay]) {
      const set = materialsFor(theme);
      for (const key of [...BUILDINGS, ...TEXTURED_GROUND, ...UNTEXTURED_GROUND]) expect((set[key] as THREE.MeshLambertMaterial).map, `${theme.id} ${key}`).toBeFalsy();
    }
  });
});

describe("Realistic's shader patches", () => {
  it("find their anchors in the installed three.js Lambert shader", () => {
    const [vertex, fragment] = lambertSource().split("export const fragment");
    expect(vertex).toContain(REALISTIC_ANCHORS.vertexPars);
    expect(vertex).toContain(REALISTIC_ANCHORS.vertexUv);
    expect(fragment).toContain(REALISTIC_ANCHORS.fragmentPars);
    expect(fragment).toContain(REALISTIC_ANCHORS.fragmentMap);
  });

  it("run both the texture and the window patch from one onBeforeCompile on a building", () => {
    const material = materialsFor(realistic).buildingGenerated;
    const shader = fakeShader();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    // The texture patch: wall and roof coordinates, the roof sampler, and the map lookup replaced.
    expect(shader.vertexShader).toContain("vMapUv = mix(realWall, realFlat, realRoof)");
    expect(shader.fragmentShader).toContain("uniform sampler2D uRoof");
    expect(shader.fragmentShader).toContain("mix(realFacade, realRoofTexel, vRealRoof)");
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
    expect(shader.uniforms.uRoof).toBeDefined();
    // The window patch.
    expect(shader.vertexShader).toContain("vWinNormal = normal");
    expect(shader.fragmentShader).toContain("outgoingLight += uWindowColor");
    expect(shader.uniforms.uNight).toBeDefined();
    expect(shader.uniforms.uWindowColor).toBeDefined();
  });

  it("joins both cache keys, and keeps real and generated programs apart", () => {
    const set = materialsFor(realistic);
    const generated = set.buildingGenerated.customProgramCacheKey();
    const measured = set.buildingMeasured.customProgramCacheKey();
    expect(generated).toContain("realistic-building");
    expect(generated).toContain("windows-generated");
    expect(measured).toContain("realistic-building");
    expect(measured).toContain("windows-real");
    expect(generated).not.toBe(measured);
  });

  it("composePatches runs every patch in order and joins their keys", () => {
    const material = new THREE.MeshLambertMaterial();
    const order: string[] = [];
    composePatches(
      material,
      { apply: () => order.push("a"), key: "a" },
      { apply: () => order.push("b"), key: "b" },
      windowsPatch({ generated: false }),
    );
    material.onBeforeCompile(fakeShader(), {} as THREE.WebGLRenderer);
    expect(order).toEqual(["a", "b"]);
    expect(material.customProgramCacheKey()).toBe("a+b+windows-real");
  });

  it("map ground layers by world x and z over their tile", () => {
    const material = materialsFor(realistic).green;
    const shader = fakeShader();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("vMapUv = (modelMatrix * vec4(position, 1.0)).xz / 16.0000");
    expect(material.customProgramCacheKey()).toBe("realistic-ground-16.0000");
    expect(materialsFor(realistic).roadNormal.customProgramCacheKey()).toBe("realistic-ground-8.0000");
  });
});
