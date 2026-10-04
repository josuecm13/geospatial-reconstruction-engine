import { formatRoute } from "../routing/routes";
import type { LocationCard } from "./cardModel";
import { markFlyTo } from "./flyTo";
import type { PreviewLoader } from "./preview";

export interface CardContext {
  /** Draws the card's preview when it scrolls into view. The owner disposes it when its page unmounts. */
  previews: PreviewLoader;
  /** Runs when the card is opened by a plain click or Enter, just before the router navigates (the gallery saves its scroll here). */
  onOpen?: (card: LocationCard) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * One import area as a card: a preview of its footprint, where it is, when it was imported, and its counts.
 * A completed area's title is a router link to `/explore/:id` (the whole card is its click target), and opening it
 * marks the area for the map to fly to. A second link, "Open in 3D", goes straight to the scene view (no fly-to). An area whose import did not complete is shown as such and is not a link.
 * Styles are in `style.css` under `.location-card`; the gallery scopes the grid under `.locations`.
 */
export function renderLocationCard(card: LocationCard, ctx: CardContext): HTMLElement {
  const article = el("article", "location-card");
  article.dataset.status = card.status;
  article.dataset.areaId = card.id;

  const preview = el("div", "location-preview");
  const canvas = el("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Footprint of ${card.title}`);
  preview.append(canvas, el("span", "location-preview-note", "Preview unavailable"));
  if (card.status !== "completed") preview.append(el("span", "location-badge", card.statusLabel));

  const body = el("div", "location-body");
  const heading = el("h3", "location-title");
  if (card.status === "completed") {
    const link = el("a", "location-open", card.title);
    link.href = formatRoute({ page: "explore", areaId: card.id, view: "map", scope: null, at: null });
    link.dataset.link = "";
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      markFlyTo(card.id);
      ctx.onOpen?.(card);
    });
    heading.append(link);
  } else {
    heading.append(el("span", undefined, card.title));
  }
  const meta = el("p", "location-meta");
  meta.append(el("span", undefined, card.subtitle), el("span", "location-dot", "·"), el("time", undefined, card.when));
  if (card.importedAt) meta.querySelector("time")!.dateTime = card.importedAt;
  if (card.place) meta.append(el("span", "location-dot", "·"), el("span", "location-coords", card.coordinates));
  body.append(heading);
  if (card.context) body.append(el("p", "location-context", card.context));
  body.append(meta);

  if (card.counts.length) {
    const counts = el("ul", "location-counts");
    for (const count of card.counts) {
      const item = el("li");
      item.append(el("strong", undefined, count.value.toLocaleString("en-US")), el("span", undefined, count.label));
      counts.append(item);
    }
    body.append(counts);
  }

  if (card.status === "completed") {
    // A plain anchor above the card's stretched link: no fly-to, and modifier clicks keep their browser meaning.
    const scene = el("a", "location-open-3d", "Open in 3D");
    scene.href = formatRoute({ page: "explore", areaId: card.id, view: "scene", scope: null, at: null });
    scene.dataset.link = "";
    scene.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      ctx.onOpen?.(card);
    });
    body.append(scene);
  }

  article.append(preview, body);
  ctx.previews.attach(preview, card);
  return article;
}
