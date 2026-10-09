import type { NavigationDirection } from "../routing/router";

/** The name shared by the element a navigation leaves (a card's preview, the hero stage) and the one it arrives at (the explore view), so the browser morphs one into the other. */
export const PLACE = "place";

/** The one element that holds the name: a name must be unique in a document, or the browser skips the whole transition. */
let holder: HTMLElement | null = null;

/** Gives `el` the shared `place` name, taking it from any other element that still had it. */
export function claimPlace(el: HTMLElement): void {
  if (holder && holder !== el) holder.style.removeProperty("view-transition-name");
  el.style.setProperty("view-transition-name", PLACE);
  holder = el;
}

/** Clears the name wherever it is. Called once a page swap is over, so a click that never navigated leaves no name behind. */
export function releasePlace(): void {
  holder?.style.removeProperty("view-transition-name");
  holder = null;
}

/** What `document.startViewTransition` gives back, as much as the page host uses. */
export interface PageTransition {
  /** Settles when the animation has finished (or was skipped). */
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

type StartViewTransition = (options: { update: () => Promise<void>; types: string[] }) => PageTransition;

/** Whether this browser can animate a page swap at all (Chrome can; a test DOM cannot). */
export const canTransition = (): boolean => typeof (document as { startViewTransition?: unknown }).startViewTransition === "function";

/**
 * Runs `update` (the DOM swap) inside a view transition. The CSS picks the animation by the direction, as
 * `:active-view-transition-type(forward | back)`. The browser keeps showing the old frame until `update` resolves.
 */
export function startPageTransition(update: () => Promise<void>, direction: NavigationDirection): PageTransition {
  const start = (document as unknown as { startViewTransition: StartViewTransition }).startViewTransition.bind(document);
  const transition = start({ update, types: [direction] });
  // A skipped transition rejects `ready`, and a failed update rejects the others; unhandled, each would be reported as an error.
  for (const promise of [transition.finished, transition.ready, transition.updateCallbackDone]) promise.catch(() => undefined);
  return transition;
}
