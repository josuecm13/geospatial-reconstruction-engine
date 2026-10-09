import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCENE_BACKGROUND } from "../scene/palette";

const css = readFileSync(join(__dirname, "..", "style.css"), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function declarationsOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `style.css has no rule for ${selector}`).not.toBeNull();
  return match![1];
}

describe("the landing hero blends into the 3D scene", () => {
  it("--scene-background equals SCENE_BACKGROUND", () => {
    const match = css.match(/--scene-background:\s*(#[0-9a-fA-F]{6})\s*;/);
    expect(match?.[1].toLowerCase()).toBe(SCENE_BACKGROUND);
  });

  it.each([".landing .landing-hero", ".landing .landing-stage", ".landing .landing-skeleton", ".location-preview"])(
    "%s uses var(--scene-background)",
    (selector) => {
      expect(declarationsOf(selector)).toMatch(/background:\s*var\(--scene-background\)/);
    },
  );

  it("the hero's stage has no rounded frame", () => {
    expect(declarationsOf(".landing .landing-stage")).not.toContain("border-radius");
    expect(declarationsOf(".landing .landing-stage-hero")).not.toContain("border-radius");
  });
});
