import type { ApiClient } from "../api/client";
import type { Router } from "../routing/router";
import type { Route } from "../routing/routes";

/** What the shell hands every page. */
export interface PageContext<R extends Route = Route> {
  api: ApiClient;
  router: Router;
  /** The route that mounted the page. Later changes arrive through `router.subscribe`. */
  route: R;
  /** The header's slot for page-specific links (explore puts its Map/Scene toggle here); empty and hidden when unmounted. */
  tabs: HTMLElement;
}

/**
 * A page fills `el` (the `<main>` element, empty on entry) and returns its unmount function, which
 * must undo everything the mount did: listeners, subscriptions, timers, and map or WebGL resources.
 * The shell empties `el` and `tabs` after unmount. A page stays mounted while the route changes
 * inside it (explore keeps its map when the area, scope, view or camera change); it handles
 * those through `router.subscribe`.
 */
export type Mount<R extends Route = Route> = (el: HTMLElement, ctx: PageContext<R>) => () => void;
