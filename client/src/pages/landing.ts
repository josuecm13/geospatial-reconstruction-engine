import type { ImportArea } from "../api/types";
import { useErrorReporter } from "../errors/errorReporter";
import { IMPORT_MESSAGES } from "../importing/errorMessages";
import { CurrentArea } from "../importing/recentImports";
import { renderArchitecture } from "../landing/architecture";
import { renderBento } from "../landing/bento";
import { selectionDemo } from "../landing/selectionDemo";
import type { FeaturedStage } from "../landing/featuredStage";
import { pickFeatured } from "../landing/featured";
import { renderFooter } from "../landing/footer";
import { importTarget } from "../landing/importTarget";
import { shareMapData } from "../landing/sharedMapData";
import { STORY_STEPS } from "../landing/storySteps";
import { renderLocationCard } from "../locations/card";
import { formatCentre, toCard } from "../locations/cardModel";
import { PreviewLoader, type PreviewTarget } from "../locations/preview";
import { attachSpotlight } from "../ui/spotlight";
import { claimPlace } from "../ui/viewTransition";
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
  ["In", "A rectangle of up to 1 km² on the OpenStreetMap map, fetched live from Overpass."],
  [
    "Out",
    "A city model the engine owns: streets with lanes and widths, buildable blocks, buildings at the height OpenStreetMap gives them, and a road graph that can be routed over.",
  ],
  ["For", "Games, simulation, and art: places you can query, fly over, walk through, and export as glTF."],
];

/**
 * The head every section opens with: a mono eyebrow (its number is filled in by `renumber`, in page order), a display
 * heading, and at most one sentence of lede.
 */
const sectionHead = (name: string, title: string, lede?: string): HTMLElement => {
  const head = element("header", "landing-section-head");
  const eyebrow = element("p", "landing-section-eyebrow", name);
  eyebrow.dataset.name = name;
  head.append(eyebrow, element("h3", "landing-heading", title));
  if (lede) head.append(element("p", "landing-section-lede", lede));
  return head;
};

/** Numbers the visible sections' eyebrows `01 — NAME`, `02 — NAME`, ... in page order, skipping hidden ones. */
const renumber = (page: HTMLElement): void => {
  let n = 0;
  for (const eyebrow of page.querySelectorAll<HTMLElement>(".landing-section-eyebrow")) {
    if (eyebrow.closest("[hidden]")) continue;
    eyebrow.textContent = `${String(++n).padStart(2, "0")} — ${eyebrow.dataset.name}`;
  }
};

/** Runs `callback` once the browser is idle after first paint; returns a canceller. */
const afterPaint = (callback: () => void): (() => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback);
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 200);
  return () => window.clearTimeout(handle);
};

/** A 2D preview host (the gallery's: a `<canvas>` the preview loader paints into): the stage's stand-in until 3D is ready, and for good when it can't be. */
const previewHost = (label: string): HTMLElement => {
  const host = element("div", "location-preview landing-stage-fallback");
  const canvas = element("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  host.append(canvas, element("span", "location-preview-note", "Preview unavailable"));
  return host;
};

const previewTarget = (area: ImportArea): PreviewTarget => ({ id: area.id, importedAt: area.imported_at, bbox: area.bbox, status: area.status });

/**
 * `/`: a journey around the most recent place (hero, how it is rebuilt, what you can do with it), then
 * the places built so far, the way in to a new import, and the pipeline for engineers.
 */
export const mount: Mount<{ page: "landing" }> = (el, ctx) => {
  const { router } = ctx;
  const shared = shareMapData(ctx.api);
  const api = shared.api; // the featured place's map-data is fetched once for the preview, the stage and the capability visuals
  let disposed = false;
  let areas: ImportArea[] = [];
  let stage: FeaturedStage | null = null;
  let activeStep = 0;
  const cleanups: (() => void)[] = [];
  const previews = new PreviewLoader(api);

  const page = element("div", "page landing");
  cleanups.push(attachSpotlight(page, ".location-card, .bento-tile"));
  const importButton = (text: string, primary: boolean) => {
    const button = element("button", primary ? "landing-button primary" : "landing-button", text);
    button.type = "button";
    button.addEventListener("click", () => router.navigate(importTarget(areas, new CurrentArea(localStorage).id)));
    return button;
  };

  // --- hero: a skeleton until the list arrives, then the featured place, or the invitation when there is none ---
  const hero = element("section", "landing-hero");
  const heroSkeleton = element("div", "landing-inner landing-hero-grid");
  heroSkeleton.setAttribute("aria-busy", "true");
  heroSkeleton.append(element("div", "landing-skeleton landing-skeleton-text"), element("div", "landing-skeleton landing-skeleton-stage"));
  hero.append(heroSkeleton);

  // The place-dependent middle: the story, what you can do, and the places built so far.
  const journey = element("div", "landing-journey");

  // --- your turn: a full-bleed band, a street grid with a selection rectangle drawing itself ---
  const turn = element("section", "landing-section landing-cta");
  turn.append(element("div", "landing-cta-grid"));
  const turnInner = element("div", "landing-inner landing-cta-inner");
  const turnCopy = element("div", "landing-cta-copy");
  const turnHead = sectionHead("Your turn", "Your street, rebuilt in under a minute.", "Draw a rectangle of up to 1 km² and watch it build, live from OpenStreetMap.");
  turnCopy.append(turnHead, importButton("Rebuild your own place", true));
  turnInner.append(turnCopy, selectionDemo());
  turn.append(turnInner);

  // --- under the hood: a spec sheet (in / out / for) over the live pipeline ---
  const hood = element("section", "landing-section landing-hood");
  const hoodInner = element("div", "landing-inner");
  const facts = element("dl", "landing-spec");
  for (const [label, body] of FACTS) {
    const item = element("div", "landing-fact");
    item.append(element("dt", undefined, label), element("dd", undefined, body));
    facts.append(item);
  }
  const diagram = element("div", "landing-arch");
  hoodInner.append(sectionHead("Engineering", "Under the hood", "Data moves through six stages. Point at one to see what it produces."), facts, diagram);
  hood.append(hoodInner);

  page.append(hero, journey, turn, hood, renderFooter());
  el.replaceChildren(page);
  const disposeDiagram = renderArchitecture(diagram);

  /** The hero when there is nothing to feature: the invitation, plus the error sentence when the list failed. */
  const renderInvitation = (message?: string) => {
    const inner = element("div", "landing-inner landing-hero-text");
    inner.append(
      element("p", "landing-eyebrow", "Rebuilt from OpenStreetMap"),
      element("h2", undefined, "Rebuild a place from OpenStreetMap"),
      element("p", "landing-lede", "Draw a rectangle on the map and the engine rebuilds it block by block, then shows it to you in 3D."),
    );
    if (message) {
      const note = element("p", "landing-note", message);
      note.setAttribute("role", "status");
      note.dataset.state = "error";
      inner.append(note);
    }
    const actions = element("div", "landing-actions");
    actions.append(link("/explore", "Start on the map", "landing-button primary"));
    inner.append(actions);
    hero.replaceChildren(inner);
    turn.hidden = true; // the hero is already the invitation
  };

  const renderFeatured = (area: ImportArea) => {
    const sceneHref = `/explore/${area.id}?view=scene`;
    const label = area.place_name ?? formatCentre(area.bbox);

    // --- hero ---
    const heroStage = element("div", "landing-stage landing-stage-hero");
    heroStage.append(previewHost(`A map of ${label}`));
    const text = element("div", "landing-hero-text");
    const actions = element("div", "landing-actions");
    const explore = link(sceneHref, "Explore this place", "landing-button primary");
    // The hero stage morphs into the explore view; the name goes on before the router's delegated click handler navigates.
    explore.addEventListener("click", (event) => {
      if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) claimPlace(heroStage);
    });
    actions.append(explore, importButton("Rebuild your own", false));
    text.append(element("p", "landing-eyebrow", "Rebuilt from OpenStreetMap"), element("h2", undefined, label));
    if (area.place_context) text.append(element("p", "landing-context", area.place_context));
    text.append(element("p", "landing-lede", "A city block by block: streets with lanes, buildable blocks, buildings at their height."), actions);
    const heroInner = element("div", "landing-inner landing-hero-grid");
    heroInner.append(text, heroStage);
    hero.replaceChildren(heroInner);

    // --- the story: a sticky stage beside four steps that scroll ---
    const story = element("section", "landing-section landing-story");
    const storyInner = element("div", "landing-inner landing-story-grid");
    const storyStage = element("div", "landing-stage landing-stage-story");
    storyStage.append(previewHost(`A map of ${label}`));
    const stageColumn = element("div", "landing-story-stage");
    stageColumn.append(storyStage);
    const steps = element("ol", "landing-steps");
    const stepItems = STORY_STEPS.map((step, index) => {
      const item = element("li", "landing-step");
      item.dataset.step = String(index);
      item.append(element("p", "landing-step-number", `Step ${index + 1} of ${STORY_STEPS.length}`), element("h3", undefined, step.title), element("p", undefined, step.body));
      steps.append(item);
      return item;
    });
    storyInner.append(stageColumn, steps);
    const storyHeading = element("div", "landing-inner");
    storyHeading.append(sectionHead("How it is built", "How a place is rebuilt", "Four steps from an OpenStreetMap rectangle to a model you can walk through."));
    story.append(storyHeading, storyInner);

    const setActive = (index: number) => {
      activeStep = index;
      stepItems.forEach((item, i) => item.classList.toggle("is-active", i === index));
      stage?.setStep(index);
    };
    setActive(0);
    if (typeof IntersectionObserver !== "undefined") {
      // A step is active when it crosses the middle of the viewport.
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        },
        { rootMargin: "-50% 0px -50% 0px" },
      );
      stepItems.forEach((item) => observer.observe(item));
      cleanups.push(() => observer.disconnect());
    }

    // --- what you can do with it: a bento of visuals drawn from the featured place ---
    const doing = element("section", "landing-section landing-doing");
    const doingInner = element("div", "landing-inner");
    const bento = element("div", "bento");
    doingInner.append(sectionHead("Capabilities", "What you can do with it", "Route across it, walk through it, take it away as glTF."), bento);
    doing.append(doingInner);
    cleanups.push(renderBento(bento, { api, areaId: area.id, bbox: area.bbox, sceneHref }));

    // --- places built so far: the gallery's cards ---
    const recent = element("section", "landing-section landing-recent");
    const recentInner = element("div", "landing-inner");
    const grid = element("div", "landing-cards");
    const head = sectionHead("Locations", "Places built so far");
    head.append(link("/locations", "See all locations", "landing-more"));
    recentInner.append(head, grid);
    recent.append(recentInner);
    grid.replaceChildren(...areas.map((a) => renderLocationCard(toCard(a), { previews })));

    journey.replaceChildren(story, doing, recent);
    renumber(page);

    // The 2D previews stand in for the stage until the 3D one is ready, and stay if it can't be built.
    for (const slot of [heroStage, storyStage]) previews.attach(slot.querySelector<HTMLElement>(".landing-stage-fallback")!, previewTarget(area));
    cleanups.push(
      afterPaint(() => {
        // Three.js stays out of the landing page's first chunk.
        import("../landing/featuredStage")
          .then(({ createFeaturedStage }) => createFeaturedStage({ api, areaId: area.id, slots: { hero: heroStage, story: storyStage } }))
          .then((created) => {
            if (disposed) return created.dispose();
            stage = created;
            created.setStep(activeStep);
          })
          .catch(() => undefined); // no WebGL, or no map data: the 2D previews stay
      }),
    );
  };

  const featuredId: string | null = import.meta.env?.VITE_FEATURED_AREA_ID?.trim() || null;

  api.listImportAreas({ status: "completed", limit: RECENT_LIMIT }).then(
    async (list) => {
      // The configured area may be older than the recent list, so fetch it when it isn't in there.
      const configured = featuredId
        ? (list.find((a) => a.id === featuredId) ?? (await api.getImportArea(featuredId).catch(() => null)))
        : null;
      if (disposed) return;
      areas = list;
      const featured = pickFeatured(list, configured);
      if (featured) {
        shared.share(featured.id);
        renderFeatured(featured);
      } else {
        renderInvitation();
      }
      renumber(page);
    },
    (error) => {
      if (disposed) return;
      renderInvitation(report(error).sentence);
    },
  );

  return () => {
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
    stage?.dispose();
    disposeDiagram();
    previews.dispose();
  };
};
