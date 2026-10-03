/** The key a rendered preview is cached under: a re-import changes `imported_at`, so it gets a fresh preview. */
export function previewKey(areaId: string, importedAt: string | null): string {
  return `${areaId}@${importedAt ?? ""}`;
}

export interface QueuedTask<T> {
  /** The task's result; `undefined` when it was cancelled before it started. Rejects if the task does. */
  result: Promise<T | undefined>;
  /** Drops the task if it has not started; does nothing once it has. */
  cancel(): void;
}

/** Runs async tasks in the order they were added, at most `limit` at a time. */
export class TaskQueue {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  add<T>(task: () => Promise<T>): QueuedTask<T> {
    let start!: () => void;
    let cancelled!: () => void;
    const result = new Promise<T | undefined>((resolve, reject) => {
      start = () => {
        this.running += 1;
        task().then(resolve, reject).finally(() => {
          this.running -= 1;
          this.pump();
        });
      };
      cancelled = () => resolve(undefined);
    });
    this.waiting.push(start);
    this.pump();
    return {
      result,
      cancel: () => {
        const at = this.waiting.indexOf(start);
        if (at < 0) return;
        this.waiting.splice(at, 1);
        cancelled();
      },
    };
  }

  private pump(): void {
    while (this.running < this.limit && this.waiting.length) this.waiting.shift()!();
  }
}

/** A map that keeps the `capacity` most recently used entries. */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value as string);
  }

  get size(): number {
    return this.entries.size;
  }
}
