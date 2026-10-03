import { describe, expect, it, vi } from "vitest";
import { createStore, shallowEqual } from "./store";

describe("createStore", () => {
  it("returns the initial value, then the set one, and notifies with it", () => {
    const store = createStore(1);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.get()).toBe(1);
    store.set(2);
    expect(store.get()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(2);
  });

  it("derives the next value from the previous one", () => {
    const store = createStore(5);
    store.set((previous) => previous + 1);
    expect(store.get()).toBe(6);
  });

  it("does not notify for an equal value (same primitive, or a shallow-equal object)", () => {
    const store = createStore({ a: 1, b: "x" });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ a: 1, b: "x" });
    store.set((previous) => previous);
    expect(listener).not.toHaveBeenCalled();
    store.set({ a: 2, b: "x" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("uses a custom equality when given one", () => {
    const store = createStore({ id: 1, noise: 0 }, (a, b) => a.id === b.id);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ id: 1, noise: 9 });
    expect(listener).not.toHaveBeenCalled();
    expect(store.get().noise).toBe(0);
  });

  it("stops notifying after unsubscribe, and does not notify on subscribe", () => {
    const store = createStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    store.set(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("shallowEqual", () => {
  it.each([
    [1, 1, true],
    [1, 2, false],
    [{ a: 1 }, { a: 1 }, true],
    [{ a: 1 }, { a: 1, b: 2 }, false],
    [{ a: { x: 1 } }, { a: { x: 1 } }, false],
    [[1], [1], false],
    [null, null, true],
    [null, {}, false],
    [{ a: undefined }, { b: undefined }, false],
  ])("%j vs %j is %s", (a, b, expected) => {
    expect(shallowEqual(a, b)).toBe(expected);
  });
});
