import { expect, it, vi } from "vitest";
import { createToolGroup } from "./toolGroup";

it("disarms every other tool when one is armed, and never the armed one", () => {
  const group = createToolGroup();
  const pin = vi.fn();
  const route = vi.fn();
  const armPin = group.join("pin", pin);
  const armRoute = group.join("route", route);

  armPin();
  expect([pin, route].map((f) => f.mock.calls.length)).toEqual([0, 1]);
  armRoute();
  expect([pin, route].map((f) => f.mock.calls.length)).toEqual([1, 1]);
});

it("does nothing for a tool that is alone", () => {
  const arm = createToolGroup().join("pin", () => {
    throw new Error("disarmed itself");
  });
  expect(arm).not.toThrow();
});
