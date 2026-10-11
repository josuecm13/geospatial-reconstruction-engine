import { describe, expect, it, vi } from "vitest";
import type { ImportArea } from "../api/types";
import { pickFeatured, resolveFeatured } from "./featured";

const area = (id: string, status: string) => ({ id, status }) as unknown as ImportArea;

const recent0 = area("recent-0", "completed");
const recent1 = area("recent-1", "completed");
const configuredDone = area("configured", "completed");

describe("pickFeatured", () => {
  it.each([
    ["configured completed wins", [recent0, recent1], configuredDone, configuredDone],
    ["configured failed falls back", [recent0, recent1], area("c", "failed"), recent0],
    ["configured pending falls back", [recent0, recent1], area("c", "pending"), recent0],
    ["no configured area falls back", [recent0, recent1], null, recent0],
    ["nothing at all", [], null, null],
    ["configured completed with empty recent", [], configuredDone, configuredDone],
  ])("%s", (_name, recent, configured, expected) => {
    expect(pickFeatured(recent, configured)).toBe(expected);
  });

  it("takes the first completed of several candidates", () => {
    expect(pickFeatured([recent0], area("a", "failed"), configuredDone, recent1)).toBe(configuredDone);
  });
});

describe("resolveFeatured", () => {
  const older = area("older", "completed");
  const sources = (setting: () => Promise<string | null>, env: string | null = null, known: ImportArea[] = [older]) => ({
    setting,
    env,
    getArea: vi.fn(async (id: string) => {
      const found = known.find((a) => a.id === id);
      if (!found) throw new Error("not found");
      return found;
    }),
  });

  it("prefers the server setting over the environment variable", async () => {
    const s = sources(async () => "older", "recent-1");
    expect(await resolveFeatured([recent0, recent1], s)).toBe(older);
    expect(s.getArea).toHaveBeenCalledWith("older");
  });

  it("uses the area from the recent list without fetching it", async () => {
    const s = sources(async () => "recent-1");
    expect(await resolveFeatured([recent0, recent1], s)).toBe(recent1);
    expect(s.getArea).not.toHaveBeenCalled();
  });

  it("falls through to the environment variable when the setting is unset or the request fails", async () => {
    expect(await resolveFeatured([recent0, recent1], sources(async () => null, "recent-1"))).toBe(recent1);
    expect(await resolveFeatured([recent0, recent1], sources(() => Promise.reject(new Error("down")), "recent-1"))).toBe(recent1);
  });

  it("falls through to the most recent when the setting names a missing or unfinished area", async () => {
    expect(await resolveFeatured([recent0], sources(async () => "gone"))).toBe(recent0);
    const failed = area("failed", "failed");
    expect(await resolveFeatured([recent0], sources(async () => "failed", null, [failed]))).toBe(recent0);
  });

  it("falls back to the most recent with neither source, and to null with nothing", async () => {
    expect(await resolveFeatured([recent0, recent1], sources(async () => null))).toBe(recent0);
    expect(await resolveFeatured([], sources(async () => null))).toBeNull();
  });
});
