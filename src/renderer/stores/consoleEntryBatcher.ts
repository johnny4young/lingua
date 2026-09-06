import type { ConsoleEntry } from '../types/console';

export type NewConsoleEntry = Omit<ConsoleEntry, 'id' | 'timestamp'>;

export interface ConsoleEntryBatcher {
  /** Queue an entry; it reaches the store on the next flush. */
  push: (entry: NewConsoleEntry) => void;
  /** Deliver everything queued so far, synchronously. */
  flush: () => void;
}

export interface ConsoleEntryBatcherOptions {
  /** Store sink; `useConsoleStore.getState().addEntries` in production. */
  addEntries: (entries: NewConsoleEntry[]) => void;
  /**
   * Schedules the next flush. Defaults to `requestAnimationFrame` (one
   * store update per painted frame while output floods in) with a 16 ms
   * timer where rAF is missing (workers, jsdom). Injectable for tests.
   */
  schedule?: (flush: () => void) => void;
}

function defaultSchedule(flush: () => void): void {
  const raf = (globalThis as typeof globalThis & {
    requestAnimationFrame?: (callback: () => void) => number;
  }).requestAnimationFrame;
  if (typeof raf === 'function') {
    raf(flush);
  } else {
    setTimeout(flush, 16);
  }
}

/**
 * Coalesce a burst of console entries into one `addEntries` call per frame.
 * A worker posts one message per stdout line, so a `for` loop printing a
 * thousand lines used to cost a thousand store updates and re-renders; the
 * batcher turns that into one update per frame. Entries are delivered in
 * push order, and `flush()` at the end of a run guarantees nothing is left
 * queued when the run result is published.
 */
export function createConsoleEntryBatcher({
  addEntries,
  schedule = defaultSchedule,
}: ConsoleEntryBatcherOptions): ConsoleEntryBatcher {
  let queue: NewConsoleEntry[] = [];
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    addEntries(batch);
  };

  return {
    push: (entry) => {
      queue.push(entry);
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    },
    flush,
  };
}
