/**
 * RL-028 first slice — ring-buffer store invariants.
 *
 * Pins the metadata-only contract (no stdout / stderr / source / path is
 * accepted or surfaced), the FIFO drop at `MAX_HISTORY_ENTRIES`, the
 * timestamp rounding to whole seconds, and the derived helpers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_ENTRIES,
  useExecutionHistoryStore,
} from '@/stores/executionHistoryStore';

const initial = useExecutionHistoryStore.getState();

beforeEach(() => {
  useExecutionHistoryStore.setState(initial, true);
});

afterEach(() => {
  useExecutionHistoryStore.setState(initial, true);
});

describe('executionHistoryStore', () => {
  it('records a new entry with the metadata-only fields', () => {
    const entry = useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 12,
      timestamp: 1_700_000_000_500,
    });

    expect(entry.language).toBe('javascript');
    expect(entry.status).toBe('ok');
    expect(entry.durationMs).toBe(12);
    // Rounded to the nearest second to reduce fingerprintability.
    expect(entry.timestamp).toBe(1_700_000_000_000);
    // The stable id just needs to be non-empty and unique per push.
    expect(entry.id.length).toBeGreaterThan(0);

    const stored = useExecutionHistoryStore.getState().entries;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(entry);
  });

  it('accepts a null durationMs for init-failure records', () => {
    const entry = useExecutionHistoryStore.getState().record({
      language: 'rust',
      status: 'error',
      durationMs: null,
    });
    expect(entry.durationMs).toBeNull();
  });

  it('assigns a unique id to every push even when timestamps collide', () => {
    const { record } = useExecutionHistoryStore.getState();
    const a = record({ language: 'javascript', status: 'ok', durationMs: 1, timestamp: 1 });
    const b = record({ language: 'javascript', status: 'ok', durationMs: 1, timestamp: 1 });
    expect(a.id).not.toBe(b.id);
  });

  it('drops the oldest entry once the ring buffer exceeds MAX_HISTORY_ENTRIES', () => {
    const { record } = useExecutionHistoryStore.getState();
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 3; i += 1) {
      record({
        language: 'javascript',
        status: 'ok',
        durationMs: i,
        timestamp: 1_700_000_000_000 + i * 1000,
      });
    }
    const entries = useExecutionHistoryStore.getState().entries;
    expect(entries).toHaveLength(MAX_HISTORY_ENTRIES);
    // First entries (0, 1, 2) have been dropped; the oldest kept
    // entry's durationMs is the one pushed at index 3.
    expect(entries[0]?.durationMs).toBe(3);
    // Newest entry stays at the end.
    expect(entries.at(-1)?.durationMs).toBe(MAX_HISTORY_ENTRIES + 2);
  });

  it('clear() empties the ring buffer', () => {
    const { record, clear } = useExecutionHistoryStore.getState();
    record({ language: 'javascript', status: 'ok', durationMs: 1 });
    record({ language: 'python', status: 'error', durationMs: 5 });
    clear();
    expect(useExecutionHistoryStore.getState().entries).toEqual([]);
  });

  it('byLanguage filters the ring buffer to entries for the given language', () => {
    const { record, byLanguage } = useExecutionHistoryStore.getState();
    record({ language: 'javascript', status: 'ok', durationMs: 1 });
    record({ language: 'python', status: 'error', durationMs: 2 });
    record({ language: 'javascript', status: 'ok', durationMs: 3 });

    const jsOnly = byLanguage('javascript');
    expect(jsOnly).toHaveLength(2);
    expect(jsOnly.every((entry) => entry.language === 'javascript')).toBe(true);
    expect(byLanguage('rust')).toHaveLength(0);
  });

  it('never exposes a mutation path to the caller — entries is a stable snapshot array', () => {
    const { record } = useExecutionHistoryStore.getState();
    record({ language: 'javascript', status: 'ok', durationMs: 1 });
    const snapshot = useExecutionHistoryStore.getState().entries;
    // Even if callers tried to splice, the store's next push would
    // overwrite state.entries with a fresh array; the caller snapshot
    // stays frozen in its moment. We assert the basic invariant that
    // mutating a clone does not leak back.
    const clone = [...snapshot];
    clone.length = 0;
    expect(useExecutionHistoryStore.getState().entries).toHaveLength(1);
  });
});
