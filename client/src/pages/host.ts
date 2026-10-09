import type { ApiClient } from "../api/client";
import { prefersReducedMotion } from "../locations/flyTo";
import type { Router } from "../routing/router";
import type { PageName, Route } from "../routing/routes";
import { canTransition, releasePlace, startPageTransition, type PageTransition } from "../ui/viewTransition";
import type { Mount, PageContext } from "./types";

/** Loads a page's module and mounts it for `route`. Explore is a dynamic import so MapLibre loads only when it is visited. */
async function mountPage(route: Route, el: HTMLElement, base: Omit<PageContext, "route">): Promise<() => void> {
  switch (route.page) {
    case "landing":
      return (await import("./landing")).mount(el, { ...base, route });
    case "locations":
      return (await import("./locations")).mount(el, { ...base, route });
    case "explore":
      return (await import("./explore")).mount(el, { ...base, route });
    case "not-found":
      return (await import("./notFound")).mount(el, { ...base, route });
  }
}

export type { Mount };

/**
 * How long a page swap waits for the new page before the browser's transition goes on. Past this the old frame
 * stops being held (the new page's DOM still finishes mounting, whenever its module and data arrive).
 */
export const MOUNT_CAP_MS = 250;

interface Shown {
  page: PageName;
  unmount?: () => void;
}

/**
 * Keeps the page matching the route: when the route names another page, the old one is unmounted
 * (and `el` and `tabs` emptied) and the new one mounted, inside a view transition so the browser animates
 * the swap (forward or back by how the router got here). Changes inside a page are the page's own.
 * Returns a function that unmounts everything and stops listening.
 */
export function startPages(el: HTMLElement, tabs: HTMLElement, deps: { api: ApiClient; router: Router }): () => void {
  /** The page most recently asked for. */
  let current: Shown | null = null;
  /** The page whose DOM is in `el` now: the swap to a new one happens inside the transition, after the old frame is captured. */
  let shown: Shown | null = null;
  let running: PageTransition | null = null;
  let generation = 0;

  const show = async (route: Route) => {
    if (current?.page === route.page) return;
    const mine = ++generation;
    const entry: Shown = { page: route.page };
    current = entry;
    running?.skipTransition(); // a skipped transition still runs its update, which the generation guard below sorts out
    running = null;

    let transition: PageTransition | null = null;
    let mounted: Promise<void> = Promise.resolve();
    const update = async () => {
      // The route moved on before this swap ran: the newer `show` owns the slot and unmounts what is in it.
      if (mine !== generation) return;
      shown?.unmount?.();
      shown = entry;
      el.replaceChildren();
      tabs.replaceChildren();
      tabs.hidden = true;
      document.body.dataset.page = route.page;
      mounted = mountPage(route, el, { api: deps.api, router: deps.router, tabs }).then((unmount) => {
        // The route moved on to another page while this one loaded: the newer `show` owns the slot.
        if (mine !== generation) {
          unmount();
          return;
        }
        entry.unmount = unmount;
      });
      // Names are released once the page is mounted and the animation is over, so a name is never left on an element.
      void mounted.finally(() => (transition ? void transition.finished.finally(releasePlace) : releasePlace())).catch(() => undefined);
      // The browser holds the old frame until this resolves, so a slow page (lazy import, a fetch) must not hold it for long.
      await Promise.race([mounted, new Promise<void>((resolve) => window.setTimeout(resolve, MOUNT_CAP_MS))]);
    };

    if (!shown || prefersReducedMotion() || !canTransition()) {
      await update();
      await mounted;
      return;
    }
    transition = startPageTransition(update, deps.router.lastDirection);
    running = transition;
    void transition.finished.finally(() => {
      if (running === transition) running = null;
    });
  };

  const unsubscribe = deps.router.subscribe((route) => void show(route));
  void show(deps.router.get());
  return () => {
    unsubscribe();
    generation += 1;
    running?.skipTransition();
    shown?.unmount?.();
    shown = null;
    current = null;
  };
}
