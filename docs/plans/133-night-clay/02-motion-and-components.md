# 02 — Landing and components: modern Chrome CSS, motion, page transitions (#133)

Model: sonnet. Branch: `work/133-motion`, from the tip of `feat/133-night-clay`, after brief 01's
theme has landed there. Commit one commit per numbered part, and don't push. Don't run
`npm test`, `npm run build`, vitest or `openspec validate`. `cd client && npx tsc --noEmit` is
fine. **Chrome is the only target browser**, so use Chrome-shipped CSS freely, with no fallbacks or
`@supports` scaffolding.

Brief 01 made the site dark and put every colour in `:root` tokens in `client/src/style.css`. Keep
that rule: new colours are tokens or `color-mix()`/relative colours of tokens, and
`styleTokens.test.ts` enforces it. The hero, stage, skeleton and `.location-preview` rules must stay
flat, unindented and `background: var(--scene-background)`, and the hero stage must stay borderless
(`heroBackground.test.ts`). Every new animation or transition goes inside
`@media (prefers-reduced-motion: no-preference)`. The existing `prefersReducedMotion()` lives in
`client/src/locations/flyTo.ts`.

## 1. Typography

- `npm install @fontsource-variable/inter`, and import it once from `client/src/main.ts`.
- Font stack: `"Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif`.
- Use fluid sizes with `clamp()`:
  - the hero h2 is a display size (~`clamp(2.5rem, 1.6rem + 3vw, 4.25rem)`, tight letter-spacing,
    weight ~650);
  - section headings and lede are scaled to match.
- `text-wrap: balance` on h1–h3, and `text-wrap: pretty` on paragraphs and ledes.
- `text-box: trim-both cap alphabetic` on buttons, badges and tabs, so labels sit optically
  centred. Adjust their padding to match.
- `font-variant-numeric: tabular-nums` on the location counts and coordinates.

## 2. Scroll-driven motion (CSS only)

The page scrolls inside `main > .page` (`overflow: auto`), not the root.

**Header glass.**
- Add `body { timeline-scope: --page; }` and `main > .page { scroll-timeline: --page block; }`.
- `.app-header` animates over the first ~120px of `--page` (`animation-timeline: --page;
  animation-range: 0 120px; animation-fill-mode: both`):
  - from transparent;
  - to a `color-mix` of `--surface-1` at ~70% with `backdrop-filter: blur(14px) saturate(1.4)`
    and a bottom `--border` line.
- Make sure the header stays above the page. It's outside the scroller, so the blur is cosmetic
  unless the page slides under it. If it doesn't, make the header `position: absolute`/overlay with
  the page padded by `--header-height`. Verify the explore view still sizes correctly
  (`main > .view { inset: 0 }`).

**Landing progress bar.** A 2px `--accent` bar on `body[data-page="landing"]` (pseudo-element on
the header), with `scaleX` 0→1 on `animation-timeline: --page`.

**Reveals.**
- Section headings, `.landing-tile`, `.landing-fact`, `.arch-figure`, `.arch-card`,
  `.landing-cards > *` and `.landing-step` (opacity only; it already has `.is-active` logic) fade
  and rise ~24px with `animation-timeline: view(); animation-range: entry 0% entry 60%`.
- Stagger siblings with `sibling-index()`, e.g. shift the range start by
  `calc((sibling-index() - 1) * 6%)`.
- Don't remove the story-step IntersectionObserver; it drives the 3D stage.

**Locations page.** Cards in `.locations-grid` reveal the same way.

## 3. Surfaces, cards, CTA

**Raised surfaces.** Location cards, landing tiles, facts and `arch-card`:
- `--surface-1` background, a 1px `--border`, `border-radius: 18px` plus `corner-shape: squircle`;
- the hover lift kept.

**Cursor spotlight.**
- New `client/src/ui/spotlight.ts`: `attachSpotlight(root: HTMLElement, selector: string)`.
  - One delegated `pointermove` listener on `root` sets `--x`/`--y` (px, relative to the hovered
    card) on the card under the pointer, throttled with `requestAnimationFrame`.
  - Returns a disposer, called from the pages' unmount.
- Attach it on the landing and locations pages.
- CSS, under `@media (hover: hover)`: a `::before` with `radial-gradient(420px circle at var(--x)
  var(--y), color-mix(in oklch, var(--accent) 14%, transparent), transparent 60%)`, fading in on
  `:hover`.
- Make sure the card's existing full-card link `::after` still covers the card and gets the clicks.
- Unit-test the pure part (the coordinate maths) without a DOM if you split it out.

**Primary CTA border.**
- `@property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }`.
- `.landing-button.primary` gets a 1px animated `conic-gradient(from var(--angle), …)` border in
  accent tones, masked to the edge (`mask-composite: exclude`), spinning over 6s, linear.
- Under reduced motion it is static.

**Hero.**
- A soft radial accent glow behind the stage: `radial-gradient` of
  `color-mix(in oklch, var(--accent) 10%, transparent)` fading to transparent over the hero
  background, so the 3D scene's edge stays invisible.
- Check in your report that it doesn't create a visible seam at the stage's edge. If it does, put
  the glow under the text column instead.
- The eyebrow becomes a small pill: a `--surface-2` fill and an accent dot.

## 4. Page transitions (View Transitions API)

**Wrap the page swap.**
- In `client/src/pages/host.ts` `show()`, run the swap inside
  `document.startViewTransition({ update, types })`.
  - `update` empties the slot, mounts the new page and awaits `mountPage(...)`.
  - The browser holds the old frame until `update` resolves, so if `mountPage` can take long
    (lazy import plus a fetch), resolve after the page's DOM shell is in place, or cap it with
    `Promise.race([mounted, delay(250)])`. The DOM must still finish mounting either way.
- Keep the `generation` guard. Call `skipTransition()` on a running transition when a newer `show`
  starts.
- Under reduced motion, skip `startViewTransition` and swap directly.

**Direction types.**
- `client/src/routing/router.ts` records how the last navigation happened: `"forward"` for
  `navigate`/link clicks, `"back"` for `popstate`.
- Expose it (e.g. `router.lastDirection`) or pass it to subscribers, and keep existing callers
  compiling.
- Pass `types: [direction]` to the transition.
- CSS: `:active-view-transition-type(forward)` slides the root ~2% left and fades it;
  `:active-view-transition-type(back)` slides it right.

**Shared-element morph.**
- When a location card's link or "Open in 3D" is clicked, set
  `style.viewTransitionName = "place"` on that card's `.location-preview` just before navigating.
  Do it in `card.ts` on `click`, before the router's delegated handler runs; check the order.
- The hero's "Explore this place" sets it on `.landing-stage-hero`.
- The explore page's visible view container gets `view-transition-name: place`, set in
  `explore.ts` on mount for the view it opens with. Clear it after the transition finishes, so
  names stay unique.
- Style `::view-transition-group(place)` with ~450ms `cubic-bezier(.2,.8,.2,1)`.

**Tests.** The direction logic in the router is pure enough to test (router tests exist; extend
them).

## 5. Overlays, popups, tooltips, controls

**Glass.**
- `.panel`, `.scene-actions`, `.scene-toggle`, `.route-panel`, `.scene-help`, `.feature-popup`,
  `.selection-label` and `.scene-empty`: background `color-mix(in oklch, var(--surface-1) 72%,
  transparent)`, `backdrop-filter: blur(16px) saturate(1.3)`, a 1px `--border`, radius 14px with
  squircle corners, and a soft shadow.
- Buttons inside get one consistent style: ghost by default, `--accent` for primary, with hover and
  pressed states from `color-mix`.

**Entry transitions.** Anything shown by toggling `hidden`, or added after load
(`.route-panel`, `.scene-help`, `.feature-popup`, `.scene-building`, `.scene-empty`, cards
appended to grids):
- `transition: opacity, translate, display allow-discrete, overlay allow-discrete`;
- a `@starting-style` block with `opacity: 0; translate: 0 6px`;
- check that `[hidden]` still hides (add `display: none` with `allow-discrete` where needed).

**Anchor-positioned tooltips.**
- `.scene-help` is positioned against the Walk button: give `.scene-mode` an
  `anchor-name: --walk`, and `.scene-help` `position-anchor: --walk; position-area: top;
  position-try-fallbacks: flip-block`.
- The header's `#api-status` gets a tooltip explaining the state. Use a small `popover="hint"`
  element shown on hover/focus via `interestfor` if Chrome ships it in this version, else
  `popover` toggled by a tiny listener. Anchor it under the status pill.
- Keep each tooltip's text accessible: `aria-describedby`.

**Locations tools.** Search and sort inputs get dark field styling with an `--accent` focus ring
(`outline` from `color-mix`). Skeletons and shimmer use tokens.

**Reduced motion.** Also put `.scene-building`'s existing pulse under
`prefers-reduced-motion: no-preference`.

## 6. Docs

`docs/client-features.md`: a short "Look and motion" note (scroll reveals, transitions, reduced
motion). `openspec/specs/showcase-client/spec.md`: one requirement that motion is off under
`prefers-reduced-motion: reduce`, with a scenario.

## Report

- Commits and files.
- Anything in this brief Chrome didn't support as written: check the installed Chrome version's
  support for `corner-shape`, `sibling-index()`, `text-box`, `interestfor` and
  `:active-view-transition-type()` against MDN or ChromeStatus, and say what you did instead.
- How the header and scroll timeline were wired, and how you checked the explore view still lays
  out.
- The view-transition flow, including the timing cap and how names stay unique.
- Any test changes.
- The tsc result.

End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
