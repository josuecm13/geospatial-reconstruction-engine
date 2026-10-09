const SVG_NS = "http://www.w3.org/2000/svg";

/** An SVG element with its attributes set. */
export const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
};

/** A number for a path's `d`, at most two decimals, so the markup stays small. */
export const num = (value: number): string => String(Math.round(value * 100) / 100);
