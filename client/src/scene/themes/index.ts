import { lightClay } from "./lightClay";
import { nightClay } from "./nightClay";
import type { Theme } from "./types";

export const THEMES: readonly Theme[] = [nightClay, lightClay];

export const DEFAULT_THEME: Theme = nightClay;

/** The theme with this id; Night clay for an unknown, removed or missing one. */
export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? DEFAULT_THEME;
}
