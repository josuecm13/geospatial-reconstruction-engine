import { describe, expect, it } from "vitest";
import { DEFAULT_CHOICE, loadThemeChoice, saveThemeChoice, THEME_CHOICE_KEY } from "./themeChoice";

const fake = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [[THEME_CHOICE_KEY, initial]]);
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
};
const throwing = {
  getItem: (): string | null => {
    throw new Error("denied");
  },
  setItem: (): void => {
    throw new Error("denied");
  },
};

describe("theme choice", () => {
  it("round-trips a choice under one key", () => {
    const storage = fake();
    saveThemeChoice({ theme: "light-clay", time: "night" }, storage);
    expect([...storage.data.keys()]).toEqual(["gre.sceneTheme"]);
    expect(loadThemeChoice(storage)).toEqual({ theme: "light-clay", time: "night" });
  });

  it("is Night clay at midday when nothing is stored", () => {
    expect(loadThemeChoice(fake())).toEqual({ theme: "night-clay", time: "midday" });
    expect(DEFAULT_CHOICE).toEqual({ theme: "night-clay", time: "midday" });
  });

  it("falls back when the value is unparsable or not an object", () => {
    expect(loadThemeChoice(fake("{nope"))).toEqual(DEFAULT_CHOICE);
    expect(loadThemeChoice(fake("42"))).toEqual(DEFAULT_CHOICE);
  });

  it("falls back field by field", () => {
    expect(loadThemeChoice(fake(JSON.stringify({ theme: "light-clay", time: "noon" })))).toEqual({ theme: "light-clay", time: "midday" });
    expect(loadThemeChoice(fake(JSON.stringify({ theme: "gone", time: "dawn" })))).toEqual({ theme: "night-clay", time: "dawn" });
  });

  it("treats a storage that throws as empty and never throws", () => {
    expect(loadThemeChoice(throwing)).toEqual(DEFAULT_CHOICE);
    expect(() => saveThemeChoice({ theme: "light-clay", time: "dawn" }, throwing)).not.toThrow();
  });
});
