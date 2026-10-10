# 05 — Delete an import area: the client (#133)

Model: sonnet. Branch: `work/133-delete-client`, from the tip of `origin/feat/133-night-clay`. One
commit, don't push. `npx tsc --noEmit` is fine. No `npm test` / `npm run build` / vitest: CI is the
gate. Keep the token rule (`styleTokens.test.ts`: no colour literals outside `:root`), and keep any
new motion under `prefers-reduced-motion: no-preference`.

## The problem

The server is gaining `DELETE /import-areas/{id}` (brief 04, built in parallel, so code to this
contract rather than to server code):
- **204**: deleted.
- **404 `import_area_not_found`**.
- **409 `import_in_progress`**: an import of the area is running.
- **409 `import_area_in_use`**: a larger import borrows this area's features. `details.covering_areas`
  is `[{ id, name }]`, where `name` may be null. Nothing was deleted.

The gallery (`/locations`, `src/pages/locations.ts:143`) is where the owner manages places. It needs a
way to delete one.

## Parts

1. `src/api/client.ts`: `deleteImportArea(id): Promise<void>`, next to `deleteBoundary`. Add a test
   in `client.test.ts` in the style of the existing ones: the method and path, a 204, and a 409
   surfacing `import_area_in_use` with its details.
2. `src/locations/card.ts`: an optional `onDelete?: (card: LocationCard) => void` in `CardContext`.
   When it's given, the card shows a small, quiet "Delete" button. It's a real `<button>` with an
   `aria-label` naming the place, and it must not trigger the card's open click (stop propagation,
   and keep it outside the title link). Without `onDelete`, there's no button. The landing page's
   grid (`src/pages/landing.ts:249`) passes none, so it stays read-only. Style it under
   `.location-card` in `style.css`, using tokens only.
3. `src/pages/locations.ts`: pass `onDelete`.
   - Confirm with `window.confirm`, as `boundaryPanel.ts:171` does. Name the place and say the
     delete removes its imported data and can't be undone.
   - On success, remove the card from the gallery state and the DOM without a full reload. Check
     `galleryState.ts` for where the list lives, and keep filters, sort and the empty state correct.
   - On `import_area_in_use`, tell the user which larger places to delete first (name, or
     "an unnamed area" when it's null). On `import_in_progress`, say the import is still running.
     On `import_area_not_found`, drop the card, because it's already gone. Surface errors the way
     the gallery already reports API errors, by `code`.
   - Put the message-from-error logic in a small pure function with a vitest test (no DOM), the
     way `cardModel.ts` is tested.
4. A `card.test.ts` case (it already runs under jsdom): the button appears only with `onDelete`, and
   clicking it calls `onDelete` without calling `onOpen`.
5. `docs/client-features.md`: the delete capability's row says where the client surfaces it.
   `openspec/specs/showcase-client/spec.md`: one requirement with scenarios for deleting from the
   gallery, including the refusal.

The landing page already copes with a deleted `VITE_FEATURED_AREA_ID`: `pages/landing.ts:274`
falls back when `getImportArea` fails. Don't change it.

Commit message:
`feat(client): delete a place from the locations gallery (#133)` followed by a blank line and
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
