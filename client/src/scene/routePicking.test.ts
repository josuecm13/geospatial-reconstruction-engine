import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { useErrorReporter } from "../errors/errorReporter";
import { LARGE_SNAP_METERS, ROUTING_MESSAGES, SERVER_DEFAULT, clear, failed, formatDistance, IDLE, pick, snapWarning, strategyOptions, succeeded } from "./routePicking";

const A: [number, number] = [13.4, 52.5];
const B: [number, number] = [13.41, 52.51];
const C: [number, number] = [13.42, 52.52];

describe("route picking", () => {
  it("goes idle -> origin -> requesting -> shown", () => {
    const origin = pick(IDLE, A);
    expect(origin).toEqual({ phase: "origin", origin: A });
    const requesting = pick(origin, B);
    expect(requesting).toEqual({ phase: "requesting", origin: A, destination: B });
    expect(succeeded(requesting)).toEqual({ phase: "shown", origin: A, destination: B });
  });

  it("records the error code when the request fails", () => {
    const state = failed(pick(pick(IDLE, A), B), "no_route_found");
    expect(state).toEqual({ phase: "error", origin: A, destination: B, code: "no_route_found" });
  });

  it("a third click starts over with that click as the origin", () => {
    expect(pick(succeeded(pick(pick(IDLE, A), B)), C)).toEqual({ phase: "origin", origin: C });
    expect(pick(failed(pick(pick(IDLE, A), B), "x"), C)).toEqual({ phase: "origin", origin: C });
  });

  it("ignores a late response once the user has started over", () => {
    const restarted = pick(pick(pick(IDLE, A), B), C);
    expect(succeeded(restarted)).toBe(restarted);
    expect(failed(restarted, "no_route_found")).toBe(restarted);
  });

  it("Escape clears", () => {
    expect(clear()).toEqual(IDLE);
  });
});

describe("route summary", () => {
  it("formats metres and kilometres", () => {
    expect(formatDistance(340.4)).toBe("340 m");
    expect(formatDistance(1250)).toBe("1.25 km");
  });

  it("warns only above the large-snap threshold", () => {
    expect(snapWarning("origin", LARGE_SNAP_METERS)).toBeNull();
    expect(snapWarning("origin", 40)).toBe("Your origin point is 40 m from the nearest road; the route starts there.");
    expect(snapWarning("destination", 26)).toContain("the route ends there");
  });

  it("explains routing errors by code", () => {
    const report = useErrorReporter(ROUTING_MESSAGES);
    expect(report(new ApiError(422, "no_route_found", "x")).sentence).toBe("No route connects these points.");
    expect(report(new ApiError(422, "no_navigable_node", "x")).sentence).toBe("There's no road near that point.");
  });
});

describe("strategy options", () => {
  it("lists every registered strategy with the server's default pre-selected", () => {
    expect(strategyOptions({ strategies: ["distance", "fewest_turns"], default: "fewest_turns" })).toEqual([
      { value: "distance", label: "distance", selected: false },
      { value: "fewest_turns", label: "fewest_turns", selected: true },
    ]);
  });

  it("offers only the server default, sending no strategy, when the list can't be read", () => {
    expect(strategyOptions(null)).toEqual([{ value: SERVER_DEFAULT, label: "server default", selected: true }]);
  });
});
