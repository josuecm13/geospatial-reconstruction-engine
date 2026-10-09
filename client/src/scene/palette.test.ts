import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLORS, SCENE_BACKGROUND } from "./palette";

const sceneDir = __dirname;
const viewsDir = join(__dirname, "..", "views");

const sources = [
  ...readdirSync(sceneDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "palette.ts")
    .map((name) => join(sceneDir, name)),
  join(viewsDir, "sceneView.ts"),
  join(__dirname, "..", "landing", "featuredStage.ts"),
];

/** A hex colour in a string (`#rgb`, `#rrggbb`), a `0x` colour, or a material built outside the palette. */
const FORBIDDEN = [/["'`]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?["'`]/, /\b0x[0-9a-fA-F]{6}\b/, /new THREE\.\w*Material\(/];

describe("palette.ts is the only source of scene colors", () => {
  it("covers the scene sources and the scene view", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.some((path) => path.endsWith("sceneView.ts"))).toBe(true);
    expect(sources.some((path) => path.endsWith("featuredStage.ts"))).toBe(true);
    expect(sources.some((path) => path.endsWith("palette.ts"))).toBe(false);
  });

  it.each(sources)("%s has no color literal or material of its own", (path) => {
    const text = readFileSync(path, "utf8");
    for (const pattern of FORBIDDEN) {
      const match = text.match(pattern);
      expect(match, `${path} contains ${match?.[0]}: put it in palette.ts instead`).toBeNull();
    }
  });
});

describe("SCENE_BACKGROUND", () => {
  it("is the ground colour as it renders on an upward face", () => {
    expect(COLORS.ground).toBe("#e6e1d8");
    expect(SCENE_BACKGROUND).toBe("#e1dcd3");
  });
});
