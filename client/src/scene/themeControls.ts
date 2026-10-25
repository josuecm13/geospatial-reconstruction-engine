import { ApiError } from "../api/client";
import type { LandingTheme } from "../api/types";
import { THEMES, themeById } from "./themes";
import { TIMES_OF_DAY, type ThemeId, type TimeOfDay } from "./themes/types";
import type { ThemeChoice } from "./themeChoice";

export interface ThemeControlsOptions {
  initial: ThemeChoice;
  onTheme(id: ThemeId): void;
  onTime(time: TimeOfDay): void;
  /** When given, a "Use on landing" button calls this with the current choice. Without it the button is not there. */
  setLandingTheme?(value: LandingTheme): Promise<unknown>;
}

export interface ThemeControls {
  element: HTMLElement;
  /** The choice as shown. */
  choice(): ThemeChoice;
}

const TIME_LABELS: Record<TimeOfDay, string> = { dawn: "Dawn", midday: "Midday", "golden-hour": "Golden hour", night: "Night" };

/** The scene's theme picker, time-of-day buttons and "Use on landing". Plain DOM; the owner applies and saves what the callbacks report. */
export function createThemeControls(container: HTMLElement, options: ThemeControlsOptions): ThemeControls {
  let { theme, time } = options.initial;
  const element = Object.assign(document.createElement("div"), { className: "scene-theme" });

  const select = Object.assign(document.createElement("select"), { id: "scene-theme-select" });
  for (const candidate of THEMES) select.append(new Option(candidate.label, candidate.id));
  const selectLabel = Object.assign(document.createElement("label"), { htmlFor: select.id, textContent: "Theme" });

  const timeGroup = Object.assign(document.createElement("div"), { className: "scene-theme-times" });
  timeGroup.setAttribute("role", "group");
  timeGroup.setAttribute("aria-label", "Time of day");
  const buttons = new Map<TimeOfDay, HTMLButtonElement>();
  const note = Object.assign(document.createElement("span"), { className: "scene-theme-note", textContent: "Fixed light", hidden: true });
  const landing = Object.assign(document.createElement("button"), {
    type: "button",
    className: "scene-theme-landing",
    textContent: "Use on landing",
    hidden: !options.setLandingTheme,
  });
  const status = Object.assign(document.createElement("span"), { className: "scene-theme-status" });
  status.setAttribute("role", "status");

  const refresh = () => {
    select.value = theme;
    const follows = themeById(theme).followsSun;
    for (const [value, button] of buttons) {
      button.disabled = !follows;
      button.setAttribute("aria-pressed", String(value === time));
    }
    note.hidden = follows;
  };

  for (const value of TIMES_OF_DAY) {
    const button = Object.assign(document.createElement("button"), { type: "button", textContent: TIME_LABELS[value] });
    button.addEventListener("click", () => {
      if (button.disabled || time === value) return;
      time = value;
      refresh();
      options.onTime(value);
    });
    buttons.set(value, button);
    timeGroup.append(button);
  }

  select.addEventListener("change", () => {
    theme = themeById(select.value).id;
    refresh();
    status.textContent = "";
    options.onTheme(theme);
  });
  landing.addEventListener("click", async () => {
    if (!options.setLandingTheme) return;
    landing.disabled = true;
    status.dataset.state = "";
    status.textContent = "";
    try {
      await options.setLandingTheme({ theme, time_of_day: time });
      status.dataset.state = "ok";
      status.textContent = "Saved";
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error instanceof ApiError ? `Not saved (${error.code})` : "Not saved";
    } finally {
      landing.disabled = false;
    }
  });

  element.append(selectLabel, select, timeGroup, note, landing, status);
  container.append(element);
  refresh();
  return { element, choice: () => ({ theme, time }) };
}
