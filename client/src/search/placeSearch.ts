import type { ApiClient } from "../api/client";
import type { PlaceResult } from "../api/types";
import { useErrorReporter } from "../errors/errorReporter";
import { prefersReducedMotion } from "../locations/flyTo";
import { describePlace, keyAction, MAX_PLACE_ZOOM, normalizeQuery, PLACE_PADDING, placeBounds, SEARCH_LIMIT } from "./placeResults";

/** The part of a MapLibre map the search drives. */
export interface FittableMap {
  fitBounds(bounds: [[number, number], [number, number]], options: { padding: number; maxZoom: number; duration?: number; essential: boolean }): unknown;
}

const MESSAGES = {
  invalid_request: "Type at least 2 characters to search.",
  geocoder_unavailable: "Place search isn't available right now. Try again in a moment.",
  network_error: "The API couldn't be reached. Is the server running?",
  http_error: "The API isn't answering. Is the server running?",
};

let instances = 0;

/**
 * The search box over the explore map: a query is sent on Enter or the button (never per keystroke), the
 * matches are a keyboard-navigable listbox, and picking one fits the map to the place's box.
 */
export class PlaceSearch {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly button: HTMLButtonElement;
  private readonly results: HTMLElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLUListElement;
  private readonly describe = useErrorReporter(MESSAGES);
  private places: PlaceResult[] = [];
  private active = -1;
  private sent = 0;
  private readonly listId: string;
  private readonly outside = (event: PointerEvent) => {
    if (!this.root.contains(event.target as Node)) this.close();
  };

  constructor(
    host: HTMLElement,
    private readonly map: FittableMap,
    private readonly api: Pick<ApiClient, "searchPlaces">,
  ) {
    const id = `place-search-${++instances}`;
    this.listId = `${id}-list`;
    this.root = document.createElement("div");
    this.root.className = "map-search";
    this.root.innerHTML = `
      <form class="map-search-form" role="search">
        <input type="search" class="map-search-input" role="combobox" aria-label="Search for a place" placeholder="Search for a place"
          autocomplete="off" spellcheck="false" maxlength="200" aria-autocomplete="list" aria-expanded="false" aria-controls="${this.listId}" />
        <button type="submit" class="map-search-button">Search</button>
      </form>
      <div class="map-search-results" hidden>
        <p class="map-search-status" role="status" aria-live="polite"></p>
        <ul id="${this.listId}" class="map-search-list" role="listbox" aria-label="Places" hidden></ul>
        <p class="map-search-credit">Search by <a href="https://nominatim.org" target="_blank" rel="noreferrer">OpenStreetMap Nominatim</a></p>
      </div>`;
    const q = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
    this.input = q("input");
    this.button = q("button");
    this.results = q(".map-search-results");
    this.status = q(".map-search-status");
    this.list = q("ul");
    q<HTMLFormElement>("form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.search();
    });
    this.input.addEventListener("keydown", (event) => this.onKey(event));
    this.list.addEventListener("click", (event) => {
      const option = (event.target as HTMLElement).closest<HTMLElement>("[role=option]");
      if (option) this.choose(Number(option.dataset.index));
    });
    document.addEventListener("pointerdown", this.outside);
    host.append(this.root);
  }

  dispose(): void {
    this.sent += 1;
    document.removeEventListener("pointerdown", this.outside);
    this.root.remove();
  }

  private onKey(event: KeyboardEvent): void {
    const open = !this.list.hidden;
    const action = keyAction(event.key, this.active, open ? this.places.length : 0);
    if (!action) return;
    if (action.type === "close") {
      if (!this.results.hidden) {
        event.preventDefault();
        this.close();
      }
    } else if (action.type === "move") {
      event.preventDefault();
      this.setActive(action.active);
    } else {
      event.preventDefault();
      this.choose(action.index);
    }
  }

  private async search(): Promise<void> {
    const query = normalizeQuery(this.input.value);
    const mine = ++this.sent;
    if (!query) {
      this.show([], MESSAGES.invalid_request, "error");
      return;
    }
    this.button.disabled = true;
    this.show([], "Searching…", "busy");
    try {
      const places = await this.api.searchPlaces(query, SEARCH_LIMIT);
      if (mine !== this.sent) return;
      this.show(places, places.length ? `${places.length} ${places.length === 1 ? "place" : "places"} found. Use the arrow keys to choose.` : "No places found.", "");
    } catch (error) {
      if (mine !== this.sent) return;
      this.show([], this.describe(error).sentence, "error");
    } finally {
      if (mine === this.sent) this.button.disabled = false;
    }
  }

  private show(places: PlaceResult[], message: string, state: "" | "busy" | "error"): void {
    this.places = places;
    this.active = -1;
    this.results.hidden = false;
    this.status.textContent = message;
    this.status.dataset.state = state;
    this.list.replaceChildren(
      ...places.map((place, index) => {
        const line = describePlace(place);
        const item = document.createElement("li");
        item.id = `${this.listId}-${index}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        item.dataset.index = String(index);
        const title = Object.assign(document.createElement("span"), { className: "map-search-title", textContent: line.title });
        const sub = Object.assign(document.createElement("span"), {
          className: "map-search-sub",
          textContent: [line.kind, line.subtitle].filter(Boolean).join(" · "),
        });
        item.append(title, sub);
        return item;
      }),
    );
    this.list.hidden = places.length === 0;
    this.input.setAttribute("aria-expanded", String(places.length > 0));
    this.input.removeAttribute("aria-activedescendant");
  }

  private setActive(index: number): void {
    this.active = index;
    this.list.querySelectorAll<HTMLElement>("[role=option]").forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === index));
    });
    if (index >= 0) {
      this.input.setAttribute("aria-activedescendant", `${this.listId}-${index}`);
      this.list.children[index]?.scrollIntoView?.({ block: "nearest" });
    } else {
      this.input.removeAttribute("aria-activedescendant");
    }
  }

  private choose(index: number): void {
    const place = this.places[index];
    if (!place) return;
    this.map.fitBounds(placeBounds(place), {
      padding: PLACE_PADDING,
      maxZoom: MAX_PLACE_ZOOM,
      essential: false,
      ...(prefersReducedMotion() ? { duration: 0 } : {}),
    });
    this.input.value = describePlace(place).title;
    this.close();
  }

  private close(): void {
    this.sent += 1; // a search still in flight is abandoned
    this.button.disabled = false;
    this.results.hidden = true;
    this.list.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
    this.active = -1;
  }
}
