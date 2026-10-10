import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colorLiteralsOutsideRoot, contrast, parseTokens } from "./testing/cssTokens";

const css = readFileSync(join(__dirname, "style.css"), "utf8");
const tokens = parseTokens(css);

describe("style.css colours are tokens", () => {
  it("defines the token set as hex values", () => {
    for (const name of ["--scene-background", "--bg", "--surface-1", "--surface-2", "--surface-3", "--border", "--text", "--text-muted", "--accent", "--link", "--danger", "--ok", "--warning"]) {
      expect(tokens[name], name).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(tokens["--bg"]).toBe(tokens["--scene-background"]);
    expect(tokens["--accent"].toLowerCase()).toBe("#ff6b3d");
  });

  it("has no colour literal outside the :root block", () => {
    for (const { line, text } of colorLiteralsOutsideRoot(css)) {
      expect.fail(`style.css:${line} has a colour literal outside :root, use a token or a color-mix of one: ${text}`);
    }
  });

  it("scans something: the scanner finds a stray hex, rgba(), hsl() and named colour", () => {
    const stray = (declaration: string) => colorLiteralsOutsideRoot(`:root { --a: #112233; }\n.x {\n  ${declaration}\n}\n`);
    expect(stray("color: #123;")).toHaveLength(1);
    expect(stray("color: rgba(0, 0, 0, 0.5);")).toHaveLength(1);
    expect(stray("color: hsl(10 20% 30%);")).toHaveLength(1);
    expect(stray("color: white;")).toHaveLength(1);
    expect(stray("color: color-mix(in oklch, var(--text) 40%, transparent);")).toHaveLength(0);
    expect(stray("border-color: currentColor;")).toHaveLength(0);
  });
});

/** [foreground token, background tokens it is drawn on]. The button text is `--bg` on an accent, danger or link fill. */
const PAIRS: [string, string[]][] = [
  ["--text", ["--bg", "--surface-1", "--surface-2", "--surface-3"]],
  ["--text-muted", ["--bg", "--surface-1", "--surface-2"]],
  ["--link", ["--bg", "--surface-1", "--surface-2"]],
  ["--danger", ["--bg", "--surface-1", "--surface-2"]],
  ["--ok", ["--bg", "--surface-1", "--surface-2"]],
  ["--warning", ["--bg", "--surface-1", "--surface-2"]],
  ["--bg", ["--accent", "--danger", "--link"]],
];

describe("text contrast, WCAG AA 4.5:1", () => {
  it.each(PAIRS.flatMap(([fg, backgrounds]) => backgrounds.map((bg) => [fg, bg] as const)))("%s on %s", (fg, bg) => {
    expect(contrast(tokens[fg], tokens[bg]), `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}`).toBeGreaterThanOrEqual(4.5);
  });
});
