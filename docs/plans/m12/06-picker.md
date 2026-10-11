# 1.6 Theme picker, time control, persistence, Use on landing (#141)

Read first: the "theme picker and a time control that persist" requirement in
`openspec/changes/add-scene-themes-and-time-of-day/specs/scene-themes/spec.md`, and the persistence decision in
`design.md`. Then read `client/src/views/sceneView.ts`: it already has `setTheme(id)` and `setTimeOfDay(time)`,
the "scene-toggle" controls and the tool group. Also read `client/src/scene/themes/index.ts` (`THEMES`,
`themeById`), `client/src/api/client.ts` (`setLandingTheme`), `client/src/style.css` and its token guard
`client/src/styleTokens.test.ts`, and how the location cards do "Show on landing" (grep for it).

## Do
1. **`client/src/scene/themeChoice.ts`**: `loadThemeChoice(storage = localStorage)` and `saveThemeChoice(choice, storage)`.
   - It uses one key, `gre.sceneTheme`, holding JSON `{ theme, time }`.
   - Missing, unparsable, an unknown theme or an unknown time each fall back field by field to Night clay at midday.
   - A storage that throws (private mode) is treated as empty and never breaks the scene.
   - Tests use a fake storage.
2. **The control**, in a small module `client/src/scene/themeControls.ts`, built like the other scene controls
   (plain DOM, no framework).
   - A labelled theme `<select>` listing `THEMES` by label.
   - A labelled group of four time-of-day buttons (Dawn, Midday, Golden hour, Night) with `aria-pressed`.
   - When the active theme doesn't follow the sun, the time buttons are disabled with a short note (for example "Fixed light").
   - A **Use on landing** button that calls `api.setLandingTheme({ theme, time_of_day })` and shows brief success
     or error feedback, following how Show on landing reports itself. Errors are reported by contract code, as the
     client does elsewhere.
   - Place it in the scene where it doesn't collide with the existing toggles and tools. Look at the layout in
     `style.css` and choose. It is visible whether or not an area is open.
3. **Wiring.**
   - On creation, the scene view applies the stored choice, with no animation.
   - A change calls `setTheme` or `setTimeOfDay` (animated unless reduced motion; `setTimeOfDay` already does
     that) and saves.
   - The scene view needs the API for Use on landing. Add an optional dependency in `createSceneView`'s
     signature, and pass `api` from `pages/explore.ts`. Without it the button is hidden.
4. **CSS.** Use tokens only. `styleTokens.test.ts` fails on any literal colour outside `:root`. Add a
   reduced-motion-safe style. Any transition goes inside `@media (prefers-reduced-motion: no-preference)`, as the
   spec requires.
5. **Docs.** Add a row or entry in `docs/client-features.md` for the theme picker, the time control and Use on landing.
6. **Tests:**
   - `themeChoice`: round-trip, the fallbacks, a throwing storage;
   - `themeControls` in jsdom: it renders four themes and four times; picking calls back with the id; the time
     buttons are disabled for a theme with `followsSun: false`; Use on landing calls the API with the current
     choice.

## Don't
- Touch the materials, the atmosphere, the shaders or the export.
- Run `npm test`, `vitest` or `npm run build`. `npx tsc --noEmit` in `client/` is allowed.

## Done when
Committed on `work/m12-picker` (`feat(client): ...`, with a `Co-Authored-By:` trailer naming you), not pushed.
Report the files, where the control sits, and anything you couldn't do as written.
