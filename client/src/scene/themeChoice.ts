import { DEFAULT_THEME, THEMES } from "./themes";
import { TIMES_OF_DAY, type ThemeId, type TimeOfDay } from "./themes/types";

export interface ThemeChoice {
  theme: ThemeId;
  time: TimeOfDay;
}

export const THEME_CHOICE_KEY = "gre.sceneTheme";
export const DEFAULT_CHOICE: ThemeChoice = { theme: DEFAULT_THEME.id, time: "midday" };

type Store = Pick<Storage, "getItem" | "setItem">;

const defaultStorage = (): Store | undefined => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
};

/** The stored scene look. A missing, unparsable or unknown field falls back, field by field, to Night clay at midday; a storage that throws counts as empty. */
export function loadThemeChoice(storage: Store | undefined = defaultStorage()): ThemeChoice {
  let parsed: unknown;
  try {
    const raw = storage?.getItem(THEME_CHOICE_KEY);
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  const value = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const theme = THEMES.find((candidate) => candidate.id === value.theme)?.id ?? DEFAULT_CHOICE.theme;
  const time = TIMES_OF_DAY.find((candidate) => candidate === value.time) ?? DEFAULT_CHOICE.time;
  return { theme, time };
}

/** Remembers the scene look; a storage that throws (private mode) is ignored. */
export function saveThemeChoice(choice: ThemeChoice, storage: Store | undefined = defaultStorage()): void {
  try {
    storage?.setItem(THEME_CHOICE_KEY, JSON.stringify({ theme: choice.theme, time: choice.time }));
  } catch {
    // The look just isn't remembered.
  }
}
