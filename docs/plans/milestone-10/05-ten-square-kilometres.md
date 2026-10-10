# 05 — Raise the import limit from 1 km² to 10 km² (PR #138, no issue, at the owner's request)

Model: sonnet. Branch: `work/m10-10km2`, from the tip of `origin/fix/136-dense-city-imports`. Make
**one commit**, and don't push. `python3 -m py_compile` and `cd client && npx tsc --noEmit` are fine.
No suites: CI is the gate.

The owner wants an area of up to **10 km²** importable, instead of 1 km². The rule lives in
`BoundingBox`'s validation on the server and `geo/bbox.ts` on the client, and the number appears in
copy, tests, specs and docs. Change all of it consistently. The limit stays an area, not a side
length: a 10 km² rectangle can be any shape.

## Server

- `server/app/domain/bounding_box.py`:
  - `MAX_AREA_SQUARE_METERS = 10_000_000.0`.
  - The error message's parenthetical becomes `(10 km²)`. Keep the `m^2` style of the number. Check
    which tests match on that message text, and update them.
- Update the comments in `server/app/api/schemas.py:4` and `server/app/api/routers/spatial_queries.py:86`
  that mention the 1 km² cap.
- `server/app/ingestion/overpass.py`: `QUERY_TIMEOUT_SECONDS = 180`. Ten times the area of a dense
  city can exceed 60 s on the public instance. The httpx timeout is already derived from it.
- Don't change the elevation grid's `MAX_SAMPLES` (256): a 10 km² area gets a coarser grid (about 12 m
  on a 3.16 km side) by design. Update any comment or docstring that says the cap is never reached,
  because now it is.
- Tests:
  - Grep `server/tests` for every box meant to be *too large* (`InvalidBoundingBox`,
    `invalid_bounding_box`, `exceeds`, `1_000_000`, `oversized`, `too large`), and make each one
    exceed 10 km². For example, `0.05° × 0.05°` at 30°N is about 26.8 km². Assert against the new
    constant where the test compares numbers.
  - Boxes meant to be valid stay valid. Add one valid box between 1 and 10 km², for example
    `0.02° × 0.02°` at 30°N, about 4.3 km², in `tests/domain/test_bounding_box.py`, so the new range
    is covered.
  - Also check the spatial-query API tests for a `within-bbox` box that's too large.

## Client

- `client/src/geo/bbox.ts`: `MAX_AREA_SQUARE_METERS = 10_000_000`. Check that `formatSquareKilometers`
  reads well for areas up to 10 km².
- Update every "1 km²" in user-facing copy and comments to "10 km²":
  - `importing/importPanel.ts` (the hint and the docstring);
  - `importing/rectangleDrag.ts` (the docstring and the label "over the 10 km² limit");
  - `importing/rectangleTool.ts`;
  - `importing/errorMessages.ts`;
  - `pages/landing.ts` (both lines);
  - `landing/architectureModel.ts`;
  - `locations/flyTo.ts`: at most 10 km², so it still crosses no antimeridian. Keep the claim, with
    the new number.
- Tests:
  - `importing/rectangleDrag.test.ts`: the "over the limit" cases use a `0.01° × 0.01°` box, which is
    now under the limit. Use a box over 10 km² instead, for example `0.03° × 0.03°` at the equator,
    about 11.1 km². Compute the exact label string the way the existing test does, by hand from
    the same formula, and show the arithmetic in your report.
  - Keep an under-the-limit case.
  - `geo/bbox.test.ts`: likewise, every `too_large` case must exceed 10 km², and one valid case
    should sit between 1 and 10 km².

## Specs and docs

- The OpenSpec change `openspec/changes/add-terrain-elevation/` carries this. Add MODIFIED delta
  specs, copying each requirement's full current text from `openspec/specs/<cap>/spec.md` and
  changing only the number and the scenarios that depend on it:
  - `specs/bounding-box-validation/spec.md`: the area requirement, its scenarios, and the Purpose
    line if the delta format allows it. If it doesn't, only the requirement.
  - `specs/showcase-client/spec.md`: add a MODIFIED block for "select a rectangle of up to 1 km²"
    (now 10 km²) and for the landing page requirement that mentions 1 km². That file already has
    ADDED terrain requirements from this change: add the MODIFIED section alongside them, without
    disturbing them.
  - `specs/spatial-query-api/spec.md` and `specs/import-area-api/spec.md`: only if a requirement
    or scenario states the number. Check lines 34 and 23 respectively.
  - `proposal.md`: a bullet under What Changes ("**10 km² imports**: the import limit rises from 1
    km² to 10 km², with no issue, at the owner's request") and the capabilities list.
  - `design.md`: a short decision with the trade-offs. Overpass load and the 180 s timeout; import
    time and memory growing about 10×; a coarser elevation grid past about 1.6 km per side; heavier
    3D scenes.
- Docs:
  - `README.md:5`;
  - `docs/architecture.md:5` (scope);
  - `docs/client-features.md:21`;
  - `docs/runbook.md:60`: keep the advice to import once, and add that large areas take longer
    and load the public Overpass more.
  - Leave `docs/walkthrough.md` and `HOW_TO_RUN.md` as they are. They describe a specific
    sub-1 km² example and a 1 km² benchmark, which stay true.

Commit message:
```
feat: import areas of up to 10 km² (#139)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Report:
- the SHA and `git show --stat`;
- every test you changed, with old and new boxes;
- the label arithmetic;
- anything that still mentions 1 km² and why you left it.
