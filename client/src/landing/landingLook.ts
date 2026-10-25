import type { ApiClient } from "../api/client";
import { DEFAULT_THEME, THEMES } from "../scene/themes";
import { TIMES_OF_DAY, type Theme, type TimeOfDay } from "../scene/themes/types";

export interface LandingLook {
  theme: Theme;
  time: TimeOfDay;
}

/** What the stage shows when the site setting is empty, unreadable or names something unknown. */
export const DEFAULT_LOOK: LandingLook = { theme: DEFAULT_THEME, time: "midday" };

/** The story slot's look whatever the site setting says: the phases read best as clay. */
export const STORY_LOOK: LandingLook = DEFAULT_LOOK;

/** The stage's look from the site setting's value, field by field: an unknown theme or time falls back to Night clay at midday. */
export function lookFromSetting(value: { theme?: unknown; time_of_day?: unknown } | null | undefined): LandingLook {
  const theme = THEMES.find((candidate) => candidate.id === value?.theme) ?? DEFAULT_LOOK.theme;
  const time = TIMES_OF_DAY.find((candidate) => candidate === value?.time_of_day) ?? DEFAULT_LOOK.time;
  return { theme, time };
}

/** Reads the landing theme; any failure gives the default look, so the stage always shows. */
export async function readLandingLook(api: Pick<ApiClient, "getLandingTheme">): Promise<LandingLook> {
  try {
    return lookFromSetting(await api.getLandingTheme());
  } catch {
    return DEFAULT_LOOK;
  }
}
