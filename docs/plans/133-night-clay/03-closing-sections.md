# 03 — The landing page's closing sections, redesigned (#133)

Model: sonnet. Branch: `work/133-sections`, from the tip of `feat/133-night-clay`. One commit per
numbered part, don't push. Chrome is the only target. Keep the token rule
(`styleTokens.test.ts`: no colour literals outside `:root`), the flat hero rules
(`heroBackground.test.ts`), and put all motion under `prefers-reduced-motion: no-preference`.
`npx tsc --noEmit` is fine. No `npm test` / `npm run build` / vitest / openspec.

## The problem

The owner's verdict on everything below the story is that it looks "lame and low effort, like the
Blazor / .NET default template". They're right about why:
- "What you can do with it" (`landing.ts` TILES) and "Under the hood" (FACTS) are three
  equal-width rounded boxes, each with a small heading, a paragraph and a link. That's the
  stock feature-card row.
- "Rebuild your own place" (`.landing-turn`) is a heading, a paragraph and a button in a flex
  row.
- The pipeline (`landing/architecture.ts`) is plain boxes and arrows.
- There is no footer.

Nothing in these sections shows the engine's actual output, which is the one thing a template
can't have.

## Art direction: "editorial engineering"

Night clay stays. The reference feel is a precise product page (Linear, Vercel, Stripe's
engineering pages), not a dashboard.

- **Section rhythm.**
  - Each section opens with a mono eyebrow in `--accent` (e.g. `02 — CAPABILITIES`), then a large
    display heading (`clamp(2rem, 1.2rem + 2.6vw, 3.5rem)`, tight tracking, `text-wrap: balance`),
    then at most one sentence of lede.
  - Vertical padding is `clamp(96px, 12vw, 168px)`.
  - Sections are separated by a full-width 1px hairline (`--border`) with a short `--accent`
    segment at the left, not by background changes.
  - Left-aligned, editorial: no centred text blocks.
- **A second typeface for technical text.** Add `@fontsource-variable/jetbrains-mono` and use it
  for eyebrows, numbers, stage names, file names and coordinates: `--font-mono` in `:root`.
- **No more equal three-box rows.** Every section below gets its own layout.

## 1. "What you can do with it": a bento of live visuals from the featured place

Replace the three tiles with a bento grid: 6 columns, two rows, collapsing to one column under
900px. Each tile has:
- a mono index (`01`, `02`, `03`);
- a display-weight title;
- one sentence;
- an arrow action link whose arrow slides on hover;
- a **visual that uses the real featured place**.

The landing page already has the featured area and fetches its map-data for the 2D previews. Find
where (`pages/landing.ts`, `locations/preview.ts`) and reuse that data, with no new fetch of the
same thing.

- **Route across it** (spans 4 columns × 2 rows, the hero tile):
  - Draw the featured place's road network as thin SVG polylines in a muted token, using the
    preview projection helpers (`previewTransform`, `projectToPreview` in `locations/`).
  - Ask the real API for a route between two far-apart road nodes of the place: use the client's
    existing route call in `api/client.ts`, picking the pair by maximum distance among a sample of
    nodes.
  - Draw the route on top as an `--accent` path that **draws itself** (`stroke-dasharray` /
    `stroke-dashoffset`) on a `view()` scroll timeline, with start and end markers and a mono label
    of the real `total_distance_meters` (`1.42 km`).
  - If the route call fails, show the network without the route. Nothing breaks.
- **Walk through it** (2 columns):
  - An eye-level street in SVG: two rows of building silhouettes in stone tones converging to a
    vanishing point, the road as a perspective trapezoid, and a dotted footstep path that animates
    forward.
  - Make it parametric code (heights from the featured place's actual building heights if that's
    easy, else seeded), not a static file.
- **Export it as glTF** (2 columns):
  - An isometric exploded stack: ground, roads and buildings as three stacked parallelogram planes
    (SVG or CSS 3D transforms with `transform-style: preserve-3d`) that separate on hover or focus
    and on scroll.
  - Add a mono file chip: `gre-area-<8>.glb`, from the featured area's id.

All visual colours come from CSS classes using tokens (`fill: var(--…)`), not inline colours.

## 2. "Rebuild your own place": a full-bleed call to action

Make it a band the full width of the page:
- **Background.** A faint street-grid pattern (`repeating-linear-gradient`s in a `color-mix` of
  `--border`), faded out at the edges with a radial `mask-image`.
- **Over the grid**, a dashed selection rectangle (the same visual language as the map's rectangle
  tool) that **draws itself** as it scrolls into view. Its corner handles appear, and a mono label
  ticks up to `0.98 km²`, using `@property`-registered numbers and `counter()`, or a tiny
  scroll-linked number if CSS can't.
- **Beside it**, a mono stage ticker cycling through the real import stages the server streams, as
  `✓ fetched → parsed → roads → blocks → buildings`. Read the stage names from the client's import
  stream code (`importing/` or `api/`); don't invent them.
- **A big display headline**, e.g. "Your street, rebuilt in under a minute.", one line of lede, and
  the primary button with the animated conic border from brief 02.

## 3. "Under the hood": from cards to a spec sheet and a live pipeline

- **FACTS become a three-column spec row** (In / Out / For):
  - no boxes;
  - a mono uppercase label, then the statement at ~1.375rem in `--text`, then hairline column
    dividers.
  - Under 900px it stacks with horizontal hairlines.
- **Pipeline (`architecture.ts` plus CSS):**
  - Re-skin it as a circuit: stages are pill-shaped nodes on one horizontal line, with mono stage
    numbers.
  - The edges are lines with an animated dash flowing along them (`stroke-dashoffset` keyframes),
    so data visibly moves left to right. The flow is paused under reduced motion.
  - The active stage gets an `--accent` ring and glow (`drop-shadow` filter from a `color-mix`).
  - The detail card becomes a terminal-style panel:
    - mono heading `$ stage 03 · PostGIS domain`;
    - the `produces` list as `→` lines;
    - a blinking caret after the last line;
    - the doc link styled as a mono path.
  - Keep its keyboard and pointer behaviour and its `matchMedia` layout switch. Update its tests
    only where the markup the tests read changes.

## 4. Footer

Add a real footer: a hairline top border, then three columns:
1. the project name, plus one sentence of what it is;
2. links: Locations, Rebuild your own place, the GitHub repo
   (`https://github.com/josuecm13/geospatial-reconstruction-engine`);
3. the stack in mono: `PostGIS · FastAPI · MapLibre · Three.js`, and
   `Map data © OpenStreetMap contributors` linking to the OSM copyright page.

Under it, a very large clipped wordmark ("Geospatial Reconstruction Engine", or "GRE"), filled with
a vertical gradient from `--surface-2` to transparent, the trendy way.

## 5. Look at it, then fix what you see

This brief is about taste, so check the result visually.

1. Bring up the stack with `./scripts/dev-up.sh` from the repo root (your worktree has the same
   scripts). Run the API from your worktree with the main checkout's venv:
   - `cd server`;
   - `set -a; . ../../../../server/.env; set +a` (or copy `.env` from the main checkout's
     `server/` and `client/`);
   - `/Users/josue.canales/Documents/personal-projects/geospatial-reconstruction-engine/server/.venv/bin/uvicorn app.main:app --port $APP_PORT`;
   - then `npm run dev` in `client/`.
2. Take headless Chrome screenshots at 1440×900 and 390×844 of each redesigned section. Scroll to
   it, and wait for the scroll-driven animations to settle.
3. Look at them (read the PNGs) and iterate until nothing in them reads as a stock template:
   - spacing;
   - hierarchy;
   - alignment;
   - empty-looking areas;
   - text wrapping.
4. Save the final screenshots in `/tmp/133-sections/` and list them in your report.
5. **Tear everything down before you finish:** stop uvicorn and vite, then run
   `./scripts/dev-down.sh` (not `--volumes`). The owner wants the app and the DB stopped.

## Report

- Commits and files.
- How each bento visual gets its data, including the route pair picking and the fallback.
- Where the stage names came from.
- What you changed after looking at the screenshots.
- The screenshot paths.
- The tsc result.
- Confirmation that everything is torn down.

End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
