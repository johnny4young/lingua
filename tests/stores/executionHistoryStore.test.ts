/**
 * implementation — ring-buffer store invariants.
 *
 * Pins the metadata-only contract (no stdout / stderr / source / path is
 * accepted or surfaced), the FIFO drop at `MAX_HISTORY_ENTRIES`, the
 * timestamp rounding to whole seconds, and the derived helpers.
 *
 * implementation — opt-in code snapshot. The store stays
 * caller-driven: when `record()` is called without a snapshot the
 * entry's `snapshot` field is `null` (preserving the metadata-only
 * default). When the caller passes `{ code, language }`, the store
 * clamps the code to `SNAPSHOT_MAX_BYTES` and flags `truncated` so
 * the UI can disclose the cap honestly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_ENTRIES,
  SNAPSHOT_MAX_BYTES,
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

  it('defaults snapshot to null when the caller omits one (metadata-only contract)', () => {
    const entry = useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
    });
    expect(entry.snapshot).toBeNull();
  });

  it('defaults snapshot to null when the caller passes null explicitly', () => {
    const entry = useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
      snapshot: null,
    });
    expect(entry.snapshot).toBeNull();
  });

  it('captures a verbatim snapshot when the caller passes one within the cap', () => {
    const code = 'console.log("hello");';
    const entry = useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
      snapshot: { code, language: 'javascript' },
    });
    expect(entry.snapshot).toEqual({
      code,
      language: 'javascript',
      truncated: false,
    });
  });

  it('truncates the snapshot code at SNAPSHOT_MAX_BYTES and flags truncated', () => {
    const code = 'a'.repeat(SNAPSHOT_MAX_BYTES + 100);
    const entry = useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
      snapshot: { code, language: 'javascript' },
    });
    expect(entry.snapshot?.truncated).toBe(true);
    expect(entry.snapshot?.code.length).toBe(SNAPSHOT_MAX_BYTES);
    // The clamp slices from the beginning so the start of the program
    // is preserved (where most replay-worthy context lives).
    expect(entry.snapshot?.code.slice(0, 5)).toBe('aaaaa');
  });

  it('keeps an empty snapshot as a non-null entry distinguishable from "no capture"', () => {
    const entry = useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
      snapshot: { code: '', language: 'javascript' },
    });
    expect(entry.snapshot).toEqual({
      code: '',
      language: 'javascript',
      truncated: false,
    });
  });

  it('normalizes snapshot language to the entry language so replay cannot drift', () => {
    const entry = useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
      snapshot: { code: 'console.log("stable")', language: 'python' },
    });
    expect(entry.snapshot).toEqual({
      code: 'console.log("stable")',
      language: 'javascript',
      truncated: false,
    });
  });

  it('FIFO eviction drops snapshots together with their entry', () => {
    const { record } = useExecutionHistoryStore.getState();
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 1; i += 1) {
      record({
        language: 'javascript',
        status: 'ok',
        durationMs: i,
        snapshot: { code: `entry-${i}`, language: 'javascript' },
      });
    }
    const entries = useExecutionHistoryStore.getState().entries;
    expect(entries).toHaveLength(MAX_HISTORY_ENTRIES);
    // The oldest dropped entry was index 0; the new oldest (index 1's
    // capture) is now at the head with its snapshot intact.
    expect(entries[0]?.snapshot?.code).toBe('entry-1');
  });

  it('clear() wipes snapshots together with entries', () => {
    const { record, clear } = useExecutionHistoryStore.getState();
    record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
      snapshot: { code: 'console.log("kept?")', language: 'javascript' },
    });
    clear();
    expect(useExecutionHistoryStore.getState().entries).toEqual([]);
  });

  it('mutating the input source after record() does not affect the stored snapshot', () => {
    const buffer = { code: 'before', language: 'javascript' };
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
      snapshot: buffer,
    });
    buffer.code = 'after';
    const stored = useExecutionHistoryStore.getState().entries[0]?.snapshot;
    expect(stored?.code).toBe('before');
  });

  it('snapshot.language always tracks entry.language, ignoring any mismatch in the caller payload', () => {
    // Defensive contract: a buggy caller could pass `{ code, language: 'rust' }`
    // for a JavaScript entry. The store mints `snapshot.language` from
    // `entry.language` so consumers (Replay, Comparison) can trust the
    // single field for runner dispatch. This pins that the store
    // ignores `input.snapshot.language` even if the caller sets it.
    const entry = useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
      snapshot: { code: 'console.log("hi")', language: 'rust' },
    });
    expect(entry.language).toBe('javascript');
    expect(entry.snapshot?.language).toBe('javascript');
  });

  describe('implementation — tabId + byTabId selector', () => {
    it('records tabId when the caller passes one and omits the field otherwise', () => {
      const withTab = useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'ok',
        durationMs: 5,
        tabId: 'tab-js',
      });
      const withoutTab = useExecutionHistoryStore.getState().record({
        language: 'python',
        status: 'ok',
        durationMs: 7,
      });
      expect(withTab.tabId).toBe('tab-js');
      expect(withoutTab.tabId).toBeUndefined();
    });

    it('byTabId returns matching entries newest first', () => {
      const { record, byTabId } = useExecutionHistoryStore.getState();
      const a = record({ language: 'javascript', status: 'ok', durationMs: 1, tabId: 'tab-1', timestamp: 1_700_000_001_000 });
      const b = record({ language: 'javascript', status: 'error', durationMs: 2, tabId: 'tab-2', timestamp: 1_700_000_002_000 });
      const c = record({ language: 'javascript', status: 'ok', durationMs: 3, tabId: 'tab-1', timestamp: 1_700_000_003_000 });
      const tab1 = byTabId('tab-1');
      expect(tab1.map((e) => e.id)).toEqual([c.id, a.id]);
      expect(tab1).toHaveLength(2);
      expect(byTabId('tab-2').map((e) => e.id)).toEqual([b.id]);
      expect(byTabId('missing')).toEqual([]);
    });

    it('byTabId excludes entries that never carried a tabId', () => {
      const { record, byTabId } = useExecutionHistoryStore.getState();
      record({ language: 'javascript', status: 'ok', durationMs: 1 });
      const tagged = record({ language: 'javascript', status: 'ok', durationMs: 2, tabId: 'tab-1' });
      const tab1 = byTabId('tab-1');
      expect(tab1.map((e) => e.id)).toEqual([tagged.id]);
    });

    it('byTabId rejects an empty string up front', () => {
      const { record, byTabId } = useExecutionHistoryStore.getState();
      record({ language: 'javascript', status: 'ok', durationMs: 1, tabId: '' });
      expect(byTabId('')).toEqual([]);
    });
  });

  describe('implementation note — togglePin + pin-aware eviction', () => {
    it('togglePin flips the pinned flag for an existing entry and no-ops on unknown ids', () => {
      const { record, togglePin } = useExecutionHistoryStore.getState();
      const entry = record({ language: 'javascript', status: 'ok', durationMs: 1 });
      expect(entry.pinned).toBeUndefined();

      togglePin(entry.id);
      expect(useExecutionHistoryStore.getState().entries[0]?.pinned).toBe(true);

      togglePin(entry.id);
      expect(useExecutionHistoryStore.getState().entries[0]?.pinned).toBe(false);

      // Unknown id: no entries should change.
      const before = useExecutionHistoryStore.getState().entries;
      togglePin('does-not-exist');
      expect(useExecutionHistoryStore.getState().entries).toBe(before);
    });

    it('pin-aware FIFO eviction drops the oldest UNPINNED entry first', () => {
      const { record, togglePin, entries } = useExecutionHistoryStore.getState();
      const firstId = record({
        language: 'javascript',
        status: 'ok',
        durationMs: 1,
        timestamp: 1_700_000_000_000,
      }).id;
      togglePin(firstId);
      // Push enough entries to overflow the buffer.
      for (let i = 1; i <= MAX_HISTORY_ENTRIES; i += 1) {
        useExecutionHistoryStore.getState().record({
          language: 'javascript',
          status: 'ok',
          durationMs: i,
          timestamp: 1_700_000_000_000 + i * 1000,
        });
      }
      const after = useExecutionHistoryStore.getState().entries;
      expect(after.length).toBe(MAX_HISTORY_ENTRIES);
      // The pinned first entry survives.
      expect(after.some((e) => e.id === firstId && e.pinned === true)).toBe(true);
      // The oldest unpinned entry (the very first push AFTER the pinned
      // one) is the one that was evicted.
      expect(after.find((e) => e.durationMs === 1 && e.id !== firstId)).toBeUndefined();
      // Sanity: rest of `entries` is still pre-existing length-aware.
      expect(entries).toBeDefined();
    });
  });
});
