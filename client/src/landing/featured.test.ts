import { describe, expect, it } from "vitest";
import type { ImportArea } from "../api/types";
import { pickFeatured } from "./featured";

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
});
