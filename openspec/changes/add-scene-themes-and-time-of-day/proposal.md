## Why

The scene has one fixed look, with lighting baked from one fixed light, so the city can't be shown in any
other mood or at any other time of day. Milestone 12 makes the look a typed theme that every layer reads,
and adds a sun, so the same world can be seen as a clay model, a blueprint or a low-fi realistic city, at
dawn, at midday, at golden hour or at night. Milestone 13's asset identities will plug into the same themes.

See #141.

## What Changes

- **Scene themes and time of day (#141)**: a `Theme` model read by every scene layer; four themes (Night clay, Light clay, Blueprint, Realistic); a sky dome with a sun or moon; four time-of-day presets that drive the light, the sky and the shadows; lit windows at night; a theme picker and time control that persist; themed glTF export; a landing-theme site setting; and a performance budget for 10 km² areas.

The owner chose no sub-issues for this milestone: everything ships in one PR under #141.

## Capabilities

### New Capabilities
- `scene-themes`: the theme model, the four themes, the sky, time of day, the sun, shadows, night windows, the picker and its persistence, and the performance budget.

### Modified Capabilities
- `showcase-client`: shading is fixed only in themes without a sun, and the glTF export carries the active theme's materials, textures, theme and time.
- `site-settings`: a landing-theme setting that the landing stage reads.

## Impact

- Client: `scene/palette.ts` becomes a theme registry (`scene/themes/`); materials are assigned by key so a theme can swap them live; a new sky, sun, shadow and night-window layer; procedural canvas textures for Realistic; the theme control in the scene view; the glTF export; the landing stage.
- Server: `GET`/`PUT /settings/landing-theme` on the existing key/value `site_settings` table (no migration).
- Docs: `docs/client-features.md`, `docs/architecture.md` (scene rendering), `HOW_TO_RUN.md` if anything changes there.
