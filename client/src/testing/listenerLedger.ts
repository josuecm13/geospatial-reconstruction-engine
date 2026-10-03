import { vi } from "vitest";

/** Spies on `addEventListener` / `removeEventListener` of `window` and `document`, and reports every
 * listener added and not removed. Call `restore()` when done. */
export function listenerLedger() {
  const live = new Set<string>();
  const ids = new WeakMap<object, number>();
  let counter = 0;
  const key = (target: string, type: string, listener: object, options: unknown) => {
    if (!ids.has(listener)) ids.set(listener, ++counter);
    const capture = typeof options === "boolean" ? options : Boolean((options as AddEventListenerOptions | undefined)?.capture);
    return `${target}:${type}:${ids.get(listener)}:${capture}`;
  };
  const spies: Array<{ mockRestore(): void }> = [];
  for (const [name, target] of [["window", window], ["document", document]] as const) {
    const add = target.addEventListener.bind(target) as (...args: unknown[]) => void;
    const remove = target.removeEventListener.bind(target) as (...args: unknown[]) => void;
    spies.push(
      vi.spyOn(target, "addEventListener").mockImplementation(((type: string, listener: object | null, options?: unknown) => {
        if (listener) live.add(key(name, type, listener, options));
        add(type, listener, options);
      }) as never),
      vi.spyOn(target, "removeEventListener").mockImplementation(((type: string, listener: object | null, options?: unknown) => {
        if (listener) live.delete(key(name, type, listener, options));
        remove(type, listener, options);
      }) as never),
    );
  }
  return {
    /** Listeners (as `target:type:id:capture`) added and still attached. */
    leaked: () => [...live],
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}
