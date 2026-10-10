/** Reading style.css's colour tokens: the pure helpers behind styleTokens.test.ts. */

/** The `:root { ... }` block's body, where the colour tokens are defined. */
export function rootBlock(css: string): string {
  const match = css.match(/(?:^|\n):root\s*\{([^}]*)\}/);
  if (!match) throw new Error("style.css has no :root block");
  return match[1];
}

/** Every `--name: #rrggbb` token of the `:root` block, with `var(--other)` aliases resolved. */
export function parseTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const declaration = /(--[\w-]+)\s*:\s*([^;]+);/g;
  const body = rootBlock(css).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, name, raw] of body.matchAll(declaration)) tokens[name] = raw.trim();
  const resolve = (name: string, seen: string[] = []): string => {
    const value = tokens[name];
    const alias = value?.match(/^var\((--[\w-]+)\)$/);
    if (!alias) return value;
    if (seen.includes(alias[1])) throw new Error(`token cycle at ${name}`);
    return resolve(alias[1], [...seen, name]);
  };
  return Object.fromEntries(Object.keys(tokens).map((name) => [name, resolve(name)]));
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const COLOR_FUNCTIONS = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const NAMED_COLORS = new RegExp(
  `(?<![\\w-])(?:${[
    "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown",
    "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
    "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred",
    "darksalmon", "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
    "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod",
    "gray", "green", "greenyellow", "grey", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush",
    "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey",
    "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime",
    "limegreen", "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen",
    "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin",
    "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise",
    "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue",
    "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow",
    "springgreen", "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow", "yellowgreen",
  ].join("|")})(?![\\w-])`,
  "i",
);

/**
 * The lines of style.css that hold a colour literal (hex, rgb()/hsl()/..., or a named colour other than
 * `transparent` and `currentColor`) outside the `:root` token block. Comments and `url(...)` (the search
 * icon's data URI) are not scanned; named colours are only looked for in declaration values.
 */
export function colorLiteralsOutsideRoot(css: string): { line: number; text: string }[] {
  const blanked = (text: string) => text.replace(/[^\n]/g, " ");
  const root = css.match(/(?:^|\n):root\s*\{[^}]*\}/);
  let scanned = root ? css.replace(root[0], blanked(root[0])) : css;
  scanned = scanned.replace(/\/\*[\s\S]*?\*\//g, blanked).replace(/url\([^)]*\)/g, blanked);
  const found: { line: number; text: string }[] = [];
  scanned.split("\n").forEach((text, index) => {
    const values = [...text.matchAll(/(?:^|[{;])\s*[-\w]+\s*:([^;}]*)/g)].map((m) => m[1]).join(" ");
    if (HEX.test(values) || COLOR_FUNCTIONS.test(values) || NAMED_COLORS.test(values)) found.push({ line: index + 1, text: css.split("\n")[index].trim() });
  });
  return found;
}
