import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_BYTES_PER_ENTRY,
  MAX_ENTRIES_PER_TOOL,
  UTILITY_HISTORY_STORAGE_KEY,
  useUtilityHistoryStore,
} from '@/stores/utilityHistoryStore';

const textEncoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return textEncoder.encode(value).byteLength;
}

beforeEach(() => {
  // Wipe both the in-memory state and the localStorage shadow so a
  // leaked persisted entry from a prior test can't bleed.
  useUtilityHistoryStore.setState(
    {
      history: {},
      persistEnabled: {},
      favorites: [],
    },
    false
  );
  localStorage.removeItem(UTILITY_HISTORY_STORAGE_KEY);
});

afterEach(() => {
  localStorage.removeItem(UTILITY_HISTORY_STORAGE_KEY);
});

describe('utilityHistoryStore — history', () => {
  it('starts empty', () => {
    const state = useUtilityHistoryStore.getState();
    expect(state.history).toEqual({});
    expect(state.favorites).toEqual([]);
    expect(state.persistEnabled).toEqual({});
  });

  it('pushes an entry to the front of the per-tool ring', () => {
    useUtilityHistoryStore.getState().pushEntry('json', '{"a":1}', '{\n  "a": 1\n}');
    useUtilityHistoryStore.getState().pushEntry('json', '{"b":2}', '{\n  "b": 2\n}');
    const entries = useUtilityHistoryStore.getState().history.json ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.input).toBe('{"b":2}');
    expect(entries[1]?.input).toBe('{"a":1}');
  });

  it('dedupes consecutive entries with the same input + output', () => {
    useUtilityHistoryStore.getState().pushEntry('json', 'x', 'y');
    useUtilityHistoryStore.getState().pushEntry('json', 'x', 'y');
    expect(useUtilityHistoryStore.getState().history.json).toHaveLength(1);
  });

  it('caps each tool at MAX_ENTRIES_PER_TOOL with FIFO eviction', () => {
    for (let i = 0; i < MAX_ENTRIES_PER_TOOL + 5; i += 1) {
      useUtilityHistoryStore.getState().pushEntry('json', `payload-${i}`, `${i}`);
    }
    const entries = useUtilityHistoryStore.getState().history.json ?? [];
    expect(entries).toHaveLength(MAX_ENTRIES_PER_TOOL);
    // Newest first — payload-(MAX+4) sits at index 0.
    expect(entries[0]?.input).toBe(`payload-${MAX_ENTRIES_PER_TOOL + 4}`);
    // Oldest survivor — payload-5 (the first MAX entries got evicted).
    expect(entries[MAX_ENTRIES_PER_TOOL - 1]?.input).toBe('payload-5');
  });

  it('truncates entries longer than MAX_BYTES_PER_ENTRY and flags them', () => {
    const huge = 'x'.repeat(MAX_BYTES_PER_ENTRY + 100);
    useUtilityHistoryStore.getState().pushEntry('json', huge, 'short');
    const entry = useUtilityHistoryStore.getState().history.json?.[0];
    expect(entry?.truncated).toBe(true);
    expect(utf8Bytes(entry?.input ?? '')).toBeLessThanOrEqual(MAX_BYTES_PER_ENTRY);
    expect(entry?.input.endsWith('…')).toBe(true);
  });

  it('applies the byte cap to multibyte payloads', () => {
    const huge = '🧪'.repeat(MAX_BYTES_PER_ENTRY);
    useUtilityHistoryStore.getState().pushEntry('json', huge, 'short');
    const entry = useUtilityHistoryStore.getState().history.json?.[0];
    expect(entry?.truncated).toBe(true);
    expect(utf8Bytes(entry?.input ?? '')).toBeLessThanOrEqual(MAX_BYTES_PER_ENTRY);
    expect(entry?.input.endsWith('…')).toBe(true);
  });

  it('clearHistory(toolId) wipes only that tool', () => {
    useUtilityHistoryStore.getState().pushEntry('json', 'a', 'A');
    useUtilityHistoryStore.getState().pushEntry('base64', 'b', 'B');
    useUtilityHistoryStore.getState().clearHistory('json');
    const state = useUtilityHistoryStore.getState();
    expect(state.history.json).toBeUndefined();
    expect(state.history.base64).toHaveLength(1);
  });

  it('clearHistory() with no id wipes all tools', () => {
    useUtilityHistoryStore.getState().pushEntry('json', 'a', 'A');
    useUtilityHistoryStore.getState().pushEntry('base64', 'b', 'B');
    useUtilityHistoryStore.getState().clearHistory();
    expect(useUtilityHistoryStore.getState().history).toEqual({});
  });
});

describe('utilityHistoryStore — persist toggle', () => {
  it('togglePersist flips the per-tool flag idempotently', () => {
    useUtilityHistoryStore.getState().togglePersist('json');
    expect(useUtilityHistoryStore.getState().persistEnabled.json).toBe(true);
    useUtilityHistoryStore.getState().togglePersist('json');
    expect(useUtilityHistoryStore.getState().persistEnabled.json).toBe(false);
  });
});

describe('utilityHistoryStore — favorites', () => {
  it('pinFavorite adds the id once', () => {
    useUtilityHistoryStore.getState().pinFavorite('json');
    useUtilityHistoryStore.getState().pinFavorite('json');
    expect(useUtilityHistoryStore.getState().favorites).toEqual(['json']);
  });

  it('unpinFavorite removes the id', () => {
    useUtilityHistoryStore.getState().pinFavorite('json');
    useUtilityHistoryStore.getState().pinFavorite('base64');
    useUtilityHistoryStore.getState().unpinFavorite('json');
    expect(useUtilityHistoryStore.getState().favorites).toEqual(['base64']);
  });

  it('reorderFavorites trusts a valid permutation and ignores stale ids', () => {
    useUtilityHistoryStore.getState().pinFavorite('json');
    useUtilityHistoryStore.getState().pinFavorite('base64');
    useUtilityHistoryStore.getState().pinFavorite('jwt');

    useUtilityHistoryStore.getState().reorderFavorites(['jwt', 'json', 'base64']);
    expect(useUtilityHistoryStore.getState().favorites).toEqual([
      'jwt',
      'json',
      'base64',
    ]);

    // Stale id (uuid wasn't pinned) gets sanitized out.
    useUtilityHistoryStore
      .getState()
      .reorderFavorites(['uuid' as never, 'json', 'jwt', 'base64']);
    expect(useUtilityHistoryStore.getState().favorites).toEqual([
      'json',
      'jwt',
      'base64',
    ]);
  });

  it('isFavorite reflects the current state', () => {
    expect(useUtilityHistoryStore.getState().isFavorite('json')).toBe(false);
    useUtilityHistoryStore.getState().pinFavorite('json');
    expect(useUtilityHistoryStore.getState().isFavorite('json')).toBe(true);
  });
});

describe('utilityHistoryStore — persistence partialize', () => {
  it('only persists history for tools where persistEnabled[id] is true', async () => {
    useUtilityHistoryStore.getState().togglePersist('json'); // → true
    useUtilityHistoryStore.getState().pushEntry('json', '{"a":1}', '');
    useUtilityHistoryStore.getState().pushEntry('base64', 'plain', 'cGxhaW4=');
    useUtilityHistoryStore.getState().pinFavorite('jwt');

    // Force a flush (zustand persist debounces; sync is fine for tests).
    await Promise.resolve();
    const raw = localStorage.getItem(UTILITY_HISTORY_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      state: { history: Record<string, unknown>; favorites: string[] };
    };
    expect(parsed.state.history.json).toBeDefined();
    expect(parsed.state.history.base64).toBeUndefined();
    expect(parsed.state.favorites).toEqual(['jwt']);
  });
});
