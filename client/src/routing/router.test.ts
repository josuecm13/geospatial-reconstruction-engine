// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRouter, type NavigationDirection, type Router } from "./router";

let router: Router | undefined;
afterEach(() => {
  router?.dispose();
  router = undefined;
  history.replaceState(null, "", "/");
});

/** The direction each notification saw, in order. */
const directionsSeen = (r: Router): NavigationDirection[] => {
  const seen: NavigationDirection[] = [];
  r.subscribe(() => seen.push(r.lastDirection));
  return seen;
};

describe("router.lastDirection", () => {
  it("starts as forward", () => {
    router = createRouter();
    expect(router.lastDirection).toBe("forward");
  });

  it("is forward for navigate, already set when subscribers are called", () => {
    router = createRouter();
    const seen = directionsSeen(router);
    router.navigate({ page: "locations" });
    expect(seen).toEqual(["forward"]);
  });

  it("is back for popstate, and forward again for the next navigate", () => {
    router = createRouter();
    const seen = directionsSeen(router);
    router.navigate({ page: "locations" });
    history.pushState(null, "", "/"); // what the browser has done by the time popstate fires
    window.dispatchEvent(new PopStateEvent("popstate"));
    router.navigate({ page: "locations" });
    expect(seen).toEqual(["forward", "back", "forward"]);
    expect(router.lastDirection).toBe("forward");
  });

  it("is forward for a click on a data-link anchor", () => {
    router = createRouter();
    const seen = directionsSeen(router);
    history.pushState(null, "", "/locations");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const anchor = Object.assign(document.createElement("a"), { href: "/" });
    anchor.dataset.link = "";
    document.body.append(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    anchor.remove();
    expect(seen).toEqual(["back", "forward"]);
    expect(router.get()).toEqual({ page: "landing" });
  });
});
