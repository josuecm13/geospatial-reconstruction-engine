# 1.7a Landing theme setting: API and client method (#141)

Read first: `openspec/changes/add-scene-themes-and-time-of-day/specs/site-settings/spec.md` and `design.md`
(the persistence decision). Model it on the existing featured-area setting:
`server/app/api/routers/settings.py`, `server/app/persistence/repositories/site_settings.py`, and their tests.

## Do
1. Server:
   - Add `SceneTheme` (`night-clay`, `light-clay`, `blueprint`, `realistic`) and `TimeOfDay` (`dawn`, `midday`, `golden-hour`, `night`) to `server/app/domain/enums.py`, following its style.
   - Add `GET /settings/landing-theme` and `PUT /settings/landing-theme`. The body is `{"landing_theme": {"theme": ..., "time_of_day": ...} | null}`, required but nullable, and null clears it.
   - Store it under a `landing_theme` key in the existing `site_settings` key/value table. No migration.
   - Reject an unknown theme or time as invalid input, with the stored value unchanged. Use whatever status and `code` the API error contract already uses for invalid request bodies (see `openspec/specs/api-error-contract/spec.md` and `app/api/errors.py`); don't invent a new mechanism.
2. Server tests, mirroring the featured-area tests: unset reads null; set then read round-trips; null clears; an unknown theme and an unknown time are each rejected with the value unchanged.
3. Client: `getLandingTheme()` and `setLandingTheme(value | null)` in `client/src/api/client.ts`, with types in `api/types.ts` and tests in `client.test.ts`, following the featured-area methods.
4. `docs/client-features.md`: the row for this capability, following how the featured area is listed. If an API endpoint list in `docs/architecture.md` names the settings routes, add these there too.

## Don't
- Touch the scene, the themes or the landing stage. Another task wires the stage.
- Run `pytest`, `npm test` or `npm run build` (CI does). Syntax and type checks on single files are fine.

## Done when
Committed on `work/m12-landing-theme-api` (`feat(api): ...`, ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), not pushed. Report: the files changed, the error status and code used and where that convention comes from, and the exact JSON shape.
