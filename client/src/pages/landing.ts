import type { ImportArea } from "../api/types";
import { useErrorReporter } from "../errors/errorReporter";
import { IMPORT_MESSAGES } from "../importing/errorMessages";
import { CurrentArea } from "../importing/recentImports";
import { renderArchitecture } from "../landing/architecture";
import { importTarget } from "../landing/importTarget";
import { renderLocationCard } from "../locations/card";
import { toCard } from "../locations/cardModel";
import { PreviewLoader } from "../locations/preview";
import type { Mount } from "./types";

const RECENT_LIMIT = 6;
const report = useErrorReporter(IMPORT_MESSAGES);

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const link = (href: string, text: string, className?: string): HTMLAnchorElement => {
  const a = element("a", className, text);
  a.href = href;
  a.dataset.link = "";
  return a;
};

const FACTS: readonly [string, string][] = [
  ["What goes in", "A rectangle of up to 1 km² on the OpenStreetMap map, fetched live from Overpass."],
  [
    "What comes out",
    "A city model the engine owns: streets with lanes and widths, buildable blocks, buildings at the height OpenStreetMap gives them, and a road graph that can be routed over.",
  ],
  ["What it is for", "Games, simulation, and art: places you can query, fly over, walk through, and export as glTF."],
];

/** `/`: what the engine is, how it works, and the way in to the locations and to a new import. */
export const mount: Mount<{ page: "landing" }> = (el, ctx) => {
  const { api, router } = ctx;
  let disposed = false;
  let areas: ImportArea[] = [];

  const page = element("div", "page landing");

  // --- hero ---
  const hero = element("section", "landing-hero");
  const heroInner = element("div", "landing-inner");
  const importButton = element("button", "landing-button primary", "Import a new place");
  importButton.type = "button";
  importButton.addEventListener("click", () => router.navigate(importTarget(areas, new CurrentArea(localStorage).id)));
  const actions = element("div", "landing-actions");
  actions.append(importButton, link("/locations", "Browse locations", "landing-button"));
  heroInner.append(
    element("h2", undefined, "Geospatial Reconstruction Engine"),
    element("p", "landing-lede", "Pick a place on the map and the engine rebuilds it as a queryable model, then shows it to you in 3D."),
    actions,
  );
  hero.append(heroInner);

  // --- what it is ---
  const facts = element("section", "landing-inner landing-facts");
  for (const [title, body] of FACTS) {
    const item = element("div", "landing-fact");
    item.append(element("h3", undefined, title), element("p", undefined, body));
    facts.append(item);
  }

  // --- how it works ---
  const how = element("section", "landing-inner");
  const diagram = element("div", "landing-arch");
  how.append(
    element("h3", "landing-heading", "How it works"),
    element("p", "landing-note", "Data moves through six stages. Point at one to see what it produces."),
    diagram,
  );

  // --- locations ---
  const recent = element("section", "landing-inner");
  const grid = element("div", "landing-cards");
  const status = element("p", "landing-note");
  status.setAttribute("role", "status");
  const heading = element("div", "landing-heading-row");
  heading.append(element("h3", "landing-heading", "Recent locations"), link("/locations", "See all locations"));
  recent.append(heading, status, grid);

  page.append(hero, facts, how, recent);
  el.replaceChildren(page);
  const disposeDiagram = renderArchitecture(diagram);

  // The recent places use the gallery's cards: a footprint preview, and a fly to the area when opened.
  const previews = new PreviewLoader(api);
  status.textContent = "Loading locations…";
  api.listImportAreas({ status: "completed", limit: RECENT_LIMIT }).then(
    (list) => {
      if (disposed) return;
      areas = list;
      status.textContent = list.length ? "" : "Nothing has been imported yet.";
      grid.replaceChildren(...list.map((area) => renderLocationCard(toCard(area), { previews })));
    },
    (error) => {
      if (disposed) return;
      status.textContent = report(error).sentence;
      status.dataset.state = "error";
    },
  );

  return () => {
    disposed = true;
    disposeDiagram();
    previews.dispose();
  };
};
