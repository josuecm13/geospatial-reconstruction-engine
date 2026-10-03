/** A tiny observable value: the "hook" primitive. Views `subscribe` on mount and call the returned function on unmount. */
export interface Store<T> {
  get(): T;
  /** Replaces the value (or derives it from the previous one) and notifies, unless it is equal to the old one. */
  set(next: T | ((previous: T) => T)): void;
  /** Calls `listener` on every change (not immediately); returns the unsubscribe function. */
  subscribe(listener: (value: T) => void): () => void;
}

/** `Object.is`, or, for two plain objects, `Object.is` on each own property. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function createStore<T>(initial: T, equals: (a: T, b: T) => boolean = shallowEqual): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === "function" ? (next as (previous: T) => T)(value) : next;
      if (equals(value, resolved)) return;
      value = resolved;
      for (const listener of [...listeners]) listener(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
