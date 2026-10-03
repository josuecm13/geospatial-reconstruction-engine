import { formatRoute, parseUrl, roundCamera, sameRoute, type Camera, type Route } from "./routes";
import { createStore, type Store } from "./store";

/** How long the camera must hold still before it is written to the URL. */
export const CAMERA_DEBOUNCE_MS = 300;

export interface Router {
  /** The route the address bar shows now. */
  get(): Route;
  /** Calls `listener` whenever the route changes (not immediately); returns the unsubscribe function. */
  subscribe: Store<Route>["subscribe"];
  /** Goes to a route: a new history entry, or with `replace` a rewrite of the current one. Going where we already are does nothing. */
  navigate(route: Route, options?: { replace?: boolean }): void;
  /** Records where the map is in the current explore URL, debounced, replacing the entry (the camera never adds history). */
  setCamera(camera: Camera): void;
  /** Stops listening to the browser; the router is not usable afterwards. */
  dispose(): void;
}

/**
 * The history router: the route is a store kept in step with the address bar. It follows back and
 * forward (`popstate`) and turns clicks on same-origin `<a data-link>` anchors into navigation, with
 * no page load. View and scope changes are history entries; camera moves only rewrite the entry.
 */
export function createRouter(win: Window = window): Router {
  const store = createStore<Route>(parseUrl(new URL(win.location.href)), sameRoute);
  let cameraTimer: number | undefined;
  const cancelCamera = () => {
    window.clearTimeout(cameraTimer);
    cameraTimer = undefined;
  };

  const onPopState = () => {
    cancelCamera();
    store.set(parseUrl(new URL(win.location.href)));
  };
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a[data-link]");
    if (!anchor || (anchor.target && anchor.target !== "_self")) return;
    const url = new URL(anchor.href, win.location.href);
    if (url.origin !== win.location.origin) return;
    event.preventDefault();
    router.navigate(parseUrl(url));
  };
  win.addEventListener("popstate", onPopState);
  win.document.addEventListener("click", onClick);

  const router: Router = {
    get: store.get,
    subscribe: store.subscribe,
    navigate(route, options = {}) {
      cancelCamera();
      const url = formatRoute(route);
      if (url !== win.location.pathname + win.location.search) {
        if (options.replace) win.history.replaceState(null, "", url);
        else win.history.pushState(null, "", url);
      }
      store.set(route);
    },
    setCamera(camera) {
      const before = store.get();
      if (before.page !== "explore") return;
      cancelCamera();
      cameraTimer = window.setTimeout(() => {
        cameraTimer = undefined;
        const now = store.get();
        if (now.page === "explore" && now.areaId === before.areaId) router.navigate({ ...now, at: roundCamera(camera) }, { replace: true });
      }, CAMERA_DEBOUNCE_MS);
    },
    dispose() {
      cancelCamera();
      win.removeEventListener("popstate", onPopState);
      win.document.removeEventListener("click", onClick);
    },
  };
  return router;
}
