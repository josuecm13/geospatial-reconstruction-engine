import type { ImportArea } from "../api/types";
import { renderReportedError, useErrorReporter } from "../errors/errorReporter";
import { renderLocationCard, setCardFeatured } from "../locations/card";
import { deleteOutcome } from "../locations/deleteMessage";
import { filterCards, sortCards, toCard, type LocationCard, type SortKey } from "../locations/cardModel";
import { readGalleryState, withGalleryState, type GalleryState } from "../locations/galleryState";
import { PreviewLoader } from "../locations/preview";
import { attachSpotlight } from "../ui/spotlight";
import type { Mount } from "./types";

/** The most the API returns in one list. */
const LIST_LIMIT = 200;
const SKELETONS = 6;
const SAVE_DELAY_MS = 150;

const reportError = useErrorReporter({
  http_error: "The API isn't answering. Is the server running?",
  network_error: "The API can't be reached. Is the server running?",
  database_unavailable: "The server can't reach its database.",
});

/**
 * `/locations`: every import area as a card with a preview of its footprint, filterable by text and sortable by
 * date or size. Opening a card goes to `/explore/:id`, where the map flies to it. The scroll position, filter,
 * and sort live in the history entry, so Back returns to the same spot.
 */
export const mount: Mount<{ page: "locations" }> = (el, ctx) => {
  const saved = readGalleryState(history.state);
  const state: GalleryState = { ...saved };

  const root = document.createElement("div");
  root.className = "page locations";
  root.innerHTML = `
    <header class="locations-head">
      <div>
        <h2>Locations</h2>
        <p class="locations-lede">Every place imported so far, as the engine built it. Open one to fly there.</p>
      </div>
      <div class="locations-tools">
        <label class="locations-search">
          <span class="visually-hidden">Filter locations</span>
          <input type="search" data-role="filter" placeholder="Filter by place, size or status" autocomplete="off" />
        </label>
        <label class="locations-sort">
          <span class="visually-hidden">Sort locations</span>
          <select data-role="sort">
            <option value="recent">Most recent</option>
            <option value="size">Largest</option>
            <option value="name">Name</option>
          </select>
        </label>
        <a class="locations-import" href="/explore" data-link>Import a new place</a>
      </div>
    </header>
    <p class="locations-notice" data-role="notice" role="alert" hidden></p>
    <p class="locations-count" data-role="count" role="status" aria-live="polite"></p>
    <ul class="locations-grid" data-role="grid" aria-busy="true"></ul>
    <div class="locations-message" data-role="message" hidden></div>`;
  el.replaceChildren(root);
  const pick = <T extends HTMLElement>(role: string) => root.querySelector<T>(`[data-role="${role}"]`)!;
  const filter = pick<HTMLInputElement>("filter");
  const sort = pick<HTMLSelectElement>("sort");
  const grid = pick("grid");
  const count = pick("count");
  const message = pick("message");
  const notice = pick("notice");
  filter.value = state.text;
  sort.value = state.sort;

  let disposed = false;
  let saveTimer: number | undefined;
  const previews = new PreviewLoader(ctx.api);
  const disposeSpotlight = attachSpotlight(root, ".location-card");
  let cards: LocationCard[] = [];
  const items = new Map<string, HTMLLIElement>();
  const deleting = new Set<string>();
  /** The landing page's featured area, as the server has it (null when none, or when it couldn't be read). */
  let featuredId: string | null = null;
  let choosing = false;

  // --- history state ---
  const save = () => {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    if (disposed || location.pathname !== "/locations") return;
    state.scroll = root.scrollTop;
    history.replaceState(withGalleryState(history.state, state), "");
  };
  const saveSoon = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, SAVE_DELAY_MS);
  };
  root.addEventListener("scroll", saveSoon, { passive: true });

  // --- rendering ---
  const showMessage = (text: string | null) => {
    message.hidden = text === null;
    message.textContent = text;
  };

  /** Shows the cards matching the filter, in the chosen order. Cards are moved and hidden, never rebuilt, so their previews stay. */
  const arrange = () => {
    const shown = new Set(filterCards(cards, state.text).map((card) => card.id));
    for (const card of sortCards(cards, state.sort)) {
      const item = items.get(card.id)!;
      item.hidden = !shown.has(card.id);
      grid.append(item); // appending an attached node moves it
    }
    const total = cards.length;
    count.textContent = shown.size === total ? `${total} ${total === 1 ? "place" : "places"}` : `${shown.size} of ${total} places`;
    if (!total) showMessage("Nothing has been imported yet. Use “Import a new place” to draw a rectangle on the map, and it will appear here.");
    else if (!shown.size) showMessage(`No place matches “${state.text.trim()}”.`);
    else showMessage(null);
  };

  const showSkeletons = () => {
    count.textContent = "Loading places…";
    grid.setAttribute("aria-busy", "true");
    grid.replaceChildren(
      ...Array.from({ length: SKELETONS }, () => {
        const item = document.createElement("li");
        item.className = "location-skeleton";
        item.setAttribute("aria-hidden", "true");
        item.innerHTML = `<div class="location-preview"></div><div class="location-body"><div class="bar wide"></div><div class="bar"></div></div>`;
        return item;
      }),
    );
  };

  const showError = (error: unknown) => {
    grid.replaceChildren();
    grid.setAttribute("aria-busy", "false");
    count.textContent = "";
    message.hidden = false;
    message.replaceChildren();
    const sentence = document.createElement("p");
    renderReportedError(sentence, reportError(error));
    const retry = Object.assign(document.createElement("button"), { type: "button", className: "locations-retry", textContent: "Try again" });
    retry.addEventListener("click", () => void load());
    message.append(sentence, retry);
  };

  /** Drops a card from the gallery's list and the page, then re-arranges so the count, filter and empty state stay right. */
  const removeCard = (id: string) => {
    cards = cards.filter((card) => card.id !== id);
    if (featuredId === id) featuredId = null; // the server clears the setting with the area
    items.get(id)?.remove();
    items.delete(id);
    arrange();
  };

  const onDelete = async (card: LocationCard) => {
    if (deleting.has(card.id)) return;
    if (!window.confirm(`Delete ${card.title}? This removes its imported data and can't be undone.`)) return;
    deleting.add(card.id);
    notice.hidden = true;
    try {
      await ctx.api.deleteImportArea(card.id);
      if (!disposed) removeCard(card.id);
    } catch (error) {
      if (disposed) return;
      const outcome = deleteOutcome(error, card.title);
      if (outcome.gone) removeCard(card.id);
      notice.textContent = outcome.message;
      notice.hidden = false;
    } finally {
      deleting.delete(card.id);
    }
  };

  /** Marks the featured card and clears the mark from the rest, without rebuilding any card. */
  const markFeatured = () => {
    for (const [id, item] of items) setCardFeatured(item.firstElementChild as HTMLElement, id === featuredId);
  };

  const onFeature = async (card: LocationCard, featured: boolean) => {
    if (choosing) return;
    choosing = true;
    notice.hidden = true;
    try {
      featuredId = await ctx.api.setFeaturedArea(featured ? card.id : null);
      if (!disposed) markFeatured();
    } catch (error) {
      if (disposed) return;
      notice.textContent = reportError(error).sentence;
      notice.hidden = false;
    } finally {
      choosing = false;
    }
  };

  const show = (areas: ImportArea[]) => {
    const now = new Date();
    cards = areas.map((area) => toCard(area, now));
    items.clear();
    grid.replaceChildren();
    for (const card of cards) {
      const item = document.createElement("li");
      item.append(renderLocationCard(card, { previews, onOpen: save, onDelete, featured: card.id === featuredId, onFeature }));
      items.set(card.id, item);
    }
    grid.setAttribute("aria-busy", "false");
    arrange();
    root.scrollTop = saved.scroll; // cards have a fixed shape, so the height is already right
  };

  async function load(): Promise<void> {
    showMessage(null);
    notice.hidden = true;
    showSkeletons();
    try {
      // The setting only badges a card, so a failed read is not worth failing the gallery for.
      const [areas, featured] = await Promise.all([ctx.api.listImportAreas({ limit: LIST_LIMIT }), ctx.api.featuredArea().catch(() => null)]);
      featuredId = featured;
      if (!disposed) show(areas);
    } catch (error) {
      if (!disposed) showError(error);
    }
  }

  filter.addEventListener("input", () => {
    state.text = filter.value;
    if (cards.length) arrange();
    saveSoon();
  });
  sort.addEventListener("change", () => {
    state.sort = sort.value as SortKey;
    if (cards.length) arrange();
    saveSoon();
  });
  void load();

  return () => {
    disposed = true;
    window.clearTimeout(saveTimer);
    disposeSpotlight();
    previews.dispose();
  };
};
