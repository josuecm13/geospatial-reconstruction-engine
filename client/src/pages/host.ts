import type { ApiClient } from "../api/client";
import type { Router } from "../routing/router";
import type { PageName, Route } from "../routing/routes";
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
 * Keeps the page matching the route: when the route names another page, the old one is unmounted
 * (and `el` and `tabs` emptied) and the new one mounted. Changes inside a page are the page's own.
 * Returns a function that unmounts everything and stops listening.
 */
export function startPages(el: HTMLElement, tabs: HTMLElement, deps: { api: ApiClient; router: Router }): () => void {
  let current: { page: PageName; unmount?: () => void } | null = null;
  let generation = 0;

  const show = async (route: Route) => {
    if (current?.page === route.page) return;
    const mine = ++generation;
    current?.unmount?.();
    current = { page: route.page };
    el.replaceChildren();
    tabs.replaceChildren();
    tabs.hidden = true;
    document.body.dataset.page = route.page;
    const entry = current;
    const unmount = await mountPage(route, el, { api: deps.api, router: deps.router, tabs });
    // The route moved on to another page while this one loaded: the newer `show` owns the slot.
    if (mine !== generation) {
      unmount();
      return;
    }
    entry.unmount = unmount;
  };

  const unsubscribe = deps.router.subscribe((route) => void show(route));
  void show(deps.router.get());
  return () => {
    unsubscribe();
    generation += 1;
    current?.unmount?.();
    current = null;
  };
}
