// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { ThemeChoice } from "./themeChoice";
import { createThemeControls } from "./themeControls";
import { THEMES } from "./themes";

const LIGHT: ThemeChoice = { theme: "light-clay", time: "midday" };

const setup = (initial: ThemeChoice = LIGHT, landing?: (value: unknown) => Promise<unknown>) => {
  const container = document.createElement("div");
  const onTheme = vi.fn();
  const onTime = vi.fn();
  const controls = createThemeControls(container, { initial, onTheme, onTime, setLandingTheme: landing });
  const timeButtons = () => [...container.querySelectorAll<HTMLButtonElement>(".scene-theme-times button")];
  const select = container.querySelector("select")!;
  const landingButton = container.querySelector<HTMLButtonElement>(".scene-theme-landing")!;
  const status = () => container.querySelector(".scene-theme-status")!.textContent;
  return { container, controls, onTheme, onTime, timeButtons, select, landingButton, status };
};

describe("theme controls", () => {
  it("lists every theme by label and the four times", () => {
    const { select, timeButtons, container } = setup();
    expect([...select.options].map((option) => option.textContent)).toEqual(THEMES.map((theme) => theme.label));
    expect(timeButtons().map((button) => button.textContent)).toEqual(["Dawn", "Midday", "Golden hour", "Night"]);
    expect(container.querySelector("label")!.htmlFor).toBe(select.id);
  });

  it("marks the current time pressed and reports a pick", () => {
    const { timeButtons, onTime, controls } = setup();
    expect(timeButtons().map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false"]);
    timeButtons()[3].click();
    expect(onTime).toHaveBeenCalledWith("night");
    expect(timeButtons()[3].getAttribute("aria-pressed")).toBe("true");
    expect(controls.choice()).toEqual({ theme: "light-clay", time: "night" });
  });

  it("reports a picked theme by id", () => {
    const { select, onTheme } = setup();
    select.value = "night-clay";
    select.dispatchEvent(new Event("change"));
    expect(onTheme).toHaveBeenCalledWith("night-clay");
  });

  it("disables the times, with a note, for a theme that does not follow the sun", () => {
    const fixed = THEMES.find((theme) => !theme.followsSun)!;
    const { timeButtons, container, onTime } = setup({ theme: fixed.id, time: "midday" });
    expect(timeButtons().every((button) => button.disabled)).toBe(true);
    expect(container.querySelector<HTMLElement>(".scene-theme-note")!.hidden).toBe(false);
    timeButtons()[0].click();
    expect(onTime).not.toHaveBeenCalled();
  });

  it("enables the times for a theme that follows the sun", () => {
    const { timeButtons, container } = setup();
    expect(timeButtons().some((button) => button.disabled)).toBe(false);
    expect(container.querySelector<HTMLElement>(".scene-theme-note")!.hidden).toBe(true);
  });

  it("hides Use on landing without the API", () => {
    expect(setup().landingButton.hidden).toBe(true);
  });

  it("sends the current choice from Use on landing and says so", async () => {
    const landing = vi.fn().mockResolvedValue(null);
    const { landingButton, timeButtons, status } = setup(LIGHT, landing);
    timeButtons()[2].click();
    landingButton.click();
    await vi.waitFor(() => expect(status()).toBe("Saved"));
    expect(landing).toHaveBeenCalledWith({ theme: "light-clay", time_of_day: "golden-hour" });
  });

  it("reports a failure by its contract code", async () => {
    const landing = vi.fn().mockRejectedValue(new ApiError(422, "invalid_request", "x"));
    const { landingButton, status } = setup(LIGHT, landing);
    landingButton.click();
    await vi.waitFor(() => expect(status()).toBe("Not saved (invalid_request)"));
    expect(landingButton.disabled).toBe(false);
  });
});
