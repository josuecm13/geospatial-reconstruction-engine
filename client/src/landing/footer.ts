export const REPO_URL = "https://github.com/josuecm13/geospatial-reconstruction-engine";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const STACK = ["PostGIS", "FastAPI", "MapLibre", "Three.js"] as const;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const anchor = (href: string, text: string, external: boolean): HTMLAnchorElement => {
  const a = el("a", undefined, text);
  a.href = href;
  if (external) {
    a.target = "_blank";
    a.rel = "noopener";
  } else {
    a.dataset.link = ""; // the router handles it
  }
  return a;
};

/** The landing page's footer: what the project is, where to go, what it is built with, and a very large clipped wordmark. */
export function renderFooter(): HTMLElement {
  const footer = el("footer", "landing-footer");
  const inner = el("div", "landing-inner");
  const columns = el("div", "landing-footer-columns");

  const about = el("div", "landing-footer-about");
  about.append(
    el("p", "landing-footer-name", "Geospatial Reconstruction Engine"),
    el("p", "landing-footer-blurb", "Rebuilds a real place from OpenStreetMap into streets, blocks and buildings you can query, walk through and export."),
  );

  const links = el("nav", "landing-footer-links");
  links.setAttribute("aria-label", "Project");
  links.append(el("p", "landing-footer-label", "Go to"), anchor("/locations", "Locations", false), anchor("/explore", "Rebuild your own place", false), anchor(REPO_URL, "GitHub repository", true));

  const stack = el("div", "landing-footer-stack");
  stack.append(el("p", "landing-footer-label", "Built with"), el("p", "landing-footer-mono", STACK.join(" · ")));
  const credit = el("p", "landing-footer-mono");
  credit.append("Map data © ", anchor(OSM_COPYRIGHT_URL, "OpenStreetMap contributors", true));
  stack.append(credit);

  columns.append(about, links, stack);
  const wordmark = el("div", "landing-wordmark", "GRE");
  wordmark.setAttribute("aria-hidden", "true");
  inner.append(columns, wordmark);
  footer.append(inner);
  return footer;
}
