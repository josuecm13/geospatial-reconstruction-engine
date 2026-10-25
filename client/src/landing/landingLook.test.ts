import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, lookFromSetting, readLandingLook } from "./landingLook";

describe("landing look", () => {
  it("uses the stored theme and time", () => {
    const look = lookFromSetting({ theme: "blueprint", time_of_day: "night" });
    expect(look.theme.id).toBe("blueprint");
    expect(look.time).toBe("night");
  });

  it("falls back to Night clay at midday for null or unknown values", () => {
    expect(lookFromSetting(null)).toEqual(DEFAULT_LOOK);
    expect(lookFromSetting({ theme: "nope", time_of_day: "teatime" })).toEqual(DEFAULT_LOOK);
    expect(DEFAULT_LOOK.theme.id).toBe("night-clay");
    expect(DEFAULT_LOOK.time).toBe("midday");
  });

  it("falls back field by field", () => {
    const look = lookFromSetting({ theme: "light-clay", time_of_day: "bogus" });
    expect(look.theme.id).toBe("light-clay");
    expect(look.time).toBe("midday");
  });

  it("reads through the api and swallows a failure", async () => {
    const stored = { theme: "blueprint", time_of_day: "dawn" } as never;
    expect((await readLandingLook({ getLandingTheme: async () => stored })).time).toBe("dawn");
    expect(await readLandingLook({ getLandingTheme: async () => null })).toEqual(DEFAULT_LOOK);
    const failing = async () => {
      throw new Error("down");
    };
    expect(await readLandingLook({ getLandingTheme: failing })).toEqual(DEFAULT_LOOK);
  });
});
