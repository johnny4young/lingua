import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useConsoleStore } from '@/stores/consoleStore';

describe('consoleStore', () => {
  beforeEach(() => {
    useConsoleStore.setState({
      entries: [],
      collapsedEntries: [],
      level: 'all',
      currentRun: null,
      previousRun: null,
      hiddenPayloadKinds: new Set(),
      showTimestamps: true,
    });
  });

  it('should start with no entries', () => {
    const state = useConsoleStore.getState();
    expect(state.entries).toHaveLength(0);
  });

  it('should add a log entry', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'Hello World' });

    const state = useConsoleStore.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].type).toBe('log');
    expect(state.entries[0].content).toBe('Hello World');
    expect(state.entries[0].id).toBeTruthy();
    expect(state.entries[0].timestamp).toBeGreaterThan(0);
  });

  it('should add entries of all types', () => {
    const types = ['log', 'warn', 'error', 'info', 'result'] as const;
    for (const type of types) {
      useConsoleStore.getState().addEntry({ type, content: `${type} message` });
    }

    const state = useConsoleStore.getState();
    expect(state.entries).toHaveLength(5);
    types.forEach((type, i) => {
      expect(state.entries[i].type).toBe(type);
    });
  });

  it('should add entry with optional line number', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'Line output', line: 5 });

    const state = useConsoleStore.getState();
    expect(state.entries[0].line).toBe(5);
  });

  it('should add entry with optional executionTime', () => {
    useConsoleStore.getState().addEntry({ type: 'info', content: 'Done', executionTime: 42.5 });

    const state = useConsoleStore.getState();
    expect(state.entries[0].executionTime).toBe(42.5);
  });

  it('should clear all entries', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'First' });
    useConsoleStore.getState().addEntry({ type: 'error', content: 'Second' });
    expect(useConsoleStore.getState().entries).toHaveLength(2);

    useConsoleStore.getState().clear();
    expect(useConsoleStore.getState().entries).toHaveLength(0);
  });

  // `clear` also resets the payload-kind
  // chip filter so a fresh run never displays "No entries match the
  // active filters" against stale filter state.
  it('clear also resets payload-kind chip filters', () => {
    useConsoleStore.getState().togglePayloadKindFilter('table');
    useConsoleStore.getState().togglePayloadKindFilter('mapSet');
    expect(useConsoleStore.getState().hiddenPayloadKinds.size).toBe(2);
    useConsoleStore.getState().clear();
    expect(useConsoleStore.getState().hiddenPayloadKinds.size).toBe(0);
  });

  // accessibility pass — restore() backs the clear-undo toast.
  it('restore re-instates a cleared snapshot (entries + collapsed + filters)', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'First' });
    useConsoleStore.getState().addEntry({ type: 'error', content: 'Second' });
    useConsoleStore.getState().togglePayloadKindFilter('table');

    const snapshot = {
      entries: useConsoleStore.getState().entries,
      collapsedEntries: useConsoleStore.getState().collapsedEntries,
      hiddenPayloadKinds: useConsoleStore.getState().hiddenPayloadKinds,
    };

    useConsoleStore.getState().clear();
    expect(useConsoleStore.getState().entries).toHaveLength(0);
    expect(useConsoleStore.getState().hiddenPayloadKinds.size).toBe(0);

    useConsoleStore.getState().restore(snapshot);
    const restored = useConsoleStore.getState();
    expect(restored.entries).toHaveLength(2);
    expect(restored.entries[0].content).toBe('First');
    expect(restored.collapsedEntries).toHaveLength(2);
    expect(restored.hiddenPayloadKinds.has('table')).toBe(true);
  });

  it('restore keeps entries emitted after the clear', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'Before clear' });
    const snapshot = {
      entries: useConsoleStore.getState().entries,
      collapsedEntries: useConsoleStore.getState().collapsedEntries,
      hiddenPayloadKinds: useConsoleStore.getState().hiddenPayloadKinds,
    };

    useConsoleStore.getState().clear();
    useConsoleStore.getState().addEntry({ type: 'info', content: 'After clear' });
    useConsoleStore.getState().restore(snapshot);

    const restored = useConsoleStore.getState();
    expect(restored.entries.map((entry) => entry.content)).toEqual([
      'Before clear',
      'After clear',
    ]);
    expect(restored.collapsedEntries.map((row) => row.entry.content)).toEqual([
      'Before clear',
      'After clear',
    ]);
  });

  it('restore re-collapses an identical entry across the snapshot/live boundary (PR #8)', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'A' });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'dup' });
    const snapshot = {
      entries: useConsoleStore.getState().entries,
      collapsedEntries: useConsoleStore.getState().collapsedEntries,
      hiddenPayloadKinds: useConsoleStore.getState().hiddenPayloadKinds,
    };

    useConsoleStore.getState().clear();
    // An identical entry logged after the clear must merge with the
    // restored snapshot's trailing identical entry, not sit as a 2nd row.
    useConsoleStore.getState().addEntry({ type: 'log', content: 'dup' });
    useConsoleStore.getState().restore(snapshot);

    const restored = useConsoleStore.getState();
    expect(restored.entries).toHaveLength(3); // A, dup(snap), dup(live)
    expect(restored.collapsedEntries).toHaveLength(2); // A, dup(x2)
    const dupRow = restored.collapsedEntries[1];
    expect(dupRow.entry.content).toBe('dup');
    expect(dupRow.repeatCount).toBe(2);
  });

  it('addEntries appends a batch in one update and collapses across the batch boundary', () => {
    const { addEntry, addEntries } = useConsoleStore.getState();
    const listener = vi.fn();
    const unsubscribe = useConsoleStore.subscribe(listener);
    addEntry({ type: 'log', content: 'same' });
    addEntries([
      { type: 'log', content: 'same' },
      { type: 'log', content: 'same' },
      { type: 'warn', content: 'other' },
      { type: 'warn', content: 'other' },
    ]);
    unsubscribe();

    const { entries, collapsedEntries } = useConsoleStore.getState();
    expect(entries).toHaveLength(5);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(5);
    expect(collapsedEntries.map((row) => [row.entry.content, row.repeatCount])).toEqual([
      ['same', 3],
      ['other', 2],
    ]);
    // One notification for addEntry, one for the whole batch.
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('preserves supplied emission times, including zero, and defaults direct entries to now', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(9_000);
    try {
      useConsoleStore.getState().addEntries([
        { type: 'log', content: 'first', timestamp: 0 },
        { type: 'log', content: 'second', timestamp: 2_000 },
        { type: 'log', content: 'direct' },
      ]);
      expect(useConsoleStore.getState().entries.map(entry => entry.timestamp))
        .toEqual([0, 2_000, 9_000]);
    } finally { clock.mockRestore(); }
  });

  it('addEntries with an empty batch does not notify subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = useConsoleStore.subscribe(listener);
    useConsoleStore.getState().addEntries([]);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it('should assign unique IDs to each entry', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'A' });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'B' });

    const state = useConsoleStore.getState();
    expect(state.entries[0].id).not.toBe(state.entries[1].id);
  });

  // --- Filter tests ---

  it('starts on the All segment and switches level', () => {
    expect(useConsoleStore.getState().level).toBe('all');
    useConsoleStore.getState().setLevel('warn');
    expect(useConsoleStore.getState().level).toBe('warn');
  });

  // --- Run tests ---

  it('beginRun clears output and numbers runs per tab', () => {
    const store = useConsoleStore.getState();
    store.beginRun({ tabId: 'a', startedAt: 1_000 });
    store.addEntry({ type: 'log', content: 'first', line: 2 });
    const firstVersion = useConsoleStore.getState().clearVersion;

    useConsoleStore.getState().beginRun({ tabId: 'a', startedAt: 2_000 });
    const state = useConsoleStore.getState();
    expect(state.entries).toEqual([]);
    expect(state.clearVersion).toBe(firstVersion + 1);
    expect(state.currentRun).toEqual({ tabId: 'a', number: 2, startedAt: 2_000 });
    expect(state.previousRun?.number).toBe(1);
    expect(state.previousRun?.rows.map(row => row.entry.content)).toEqual(['first']);
  });

  it('beginRun takes the number the tab run log assigned, so tab switches keep counting', () => {
    useConsoleStore.getState().beginRun({ tabId: 'a', startedAt: 1_000, number: 7 });
    expect(useConsoleStore.getState().currentRun?.number).toBe(7);
    useConsoleStore.getState().beginRun({ tabId: 'b', startedAt: 2_000, number: 3 });
    expect(useConsoleStore.getState().currentRun).toEqual({ tabId: 'b', number: 3, startedAt: 2_000 });
    expect(useConsoleStore.getState().previousRun).toBeNull();
  });

  it('keeps only line-keyed rows of the previous run, and clear drops them with the anchor', () => {
    useConsoleStore.getState().beginRun({ tabId: 'a', startedAt: 1_000 });
    useConsoleStore.getState().addEntries([
      { type: 'info', content: 'Running main.js...' },
      { type: 'log', content: 'kept', line: 3 },
    ]);
    useConsoleStore.getState().beginRun({ tabId: 'a', startedAt: 2_000 });
    expect(useConsoleStore.getState().previousRun?.rows.map(row => row.entry.content)).toEqual(['kept']);

    useConsoleStore.getState().clear();
    const state = useConsoleStore.getState();
    expect(state.previousRun).toBeNull();
    expect(state.currentRun).toEqual({ tabId: 'a', number: 2, startedAt: null });
  });

  it('beginRun without keepPrevious keeps the count but no stand-ins', () => {
    useConsoleStore.getState().beginRun({ tabId: 'a', startedAt: 1_000 });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'kept', line: 3 });
    useConsoleStore.getState().beginRun({ tabId: 'a', startedAt: 2_000, keepPrevious: false });
    const state = useConsoleStore.getState();
    expect(state.previousRun).toBeNull();
    expect(state.currentRun?.number).toBe(2);
  });

  it('dropRunAnchor turns offsets back into clock time', () => {
    useConsoleStore.getState().beginRun({ tabId: 'a', startedAt: 1_000 });
    useConsoleStore.getState().dropRunAnchor();
    expect(useConsoleStore.getState().currentRun).toEqual({ tabId: 'a', number: 1, startedAt: null });
  });

  it('beginRun on another tab drops the previous run and restarts the count', () => {
    useConsoleStore.getState().beginRun({ tabId: 'a', startedAt: 1_000 });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'from a' });
    useConsoleStore.getState().beginRun({ tabId: 'b', startedAt: null });
    const state = useConsoleStore.getState();
    expect(state.previousRun).toBeNull();
    expect(state.currentRun).toEqual({ tabId: 'b', number: 1, startedAt: null });
  });

  // --- Timestamp tests ---

  it('should start with showTimestamps = true', () => {
    expect(useConsoleStore.getState().showTimestamps).toBe(true);
  });

  it('should toggle timestamps off', () => {
    useConsoleStore.getState().toggleTimestamps();
    expect(useConsoleStore.getState().showTimestamps).toBe(false);
  });

  it('should toggle timestamps back on', () => {
    useConsoleStore.getState().toggleTimestamps();
    useConsoleStore.getState().toggleTimestamps();
    expect(useConsoleStore.getState().showTimestamps).toBe(true);
  });

  // --- payload-kind filter tests ---

  it('starts with an empty hiddenPayloadKinds set', () => {
    expect(useConsoleStore.getState().hiddenPayloadKinds.size).toBe(0);
  });

  it('toggles a payload kind into the hidden set, then out again', () => {
    useConsoleStore.getState().togglePayloadKindFilter('table');
    expect(useConsoleStore.getState().hiddenPayloadKinds.has('table')).toBe(true);
    useConsoleStore.getState().togglePayloadKindFilter('table');
    expect(useConsoleStore.getState().hiddenPayloadKinds.has('table')).toBe(false);
  });

  it('clearPayloadKindFilters empties the set even with multiple hidden kinds', () => {
    useConsoleStore.getState().togglePayloadKindFilter('table');
    useConsoleStore.getState().togglePayloadKindFilter('mapSet');
    useConsoleStore.getState().togglePayloadKindFilter('errorish');
    expect(useConsoleStore.getState().hiddenPayloadKinds.size).toBe(3);
    useConsoleStore.getState().clearPayloadKindFilters();
    expect(useConsoleStore.getState().hiddenPayloadKinds.size).toBe(0);
  });

  // --- additive payload field on entries ---

  it('preserves the rich payload alongside content when present', () => {
    useConsoleStore.getState().addEntry({
      type: 'log',
      content: 'Table(2×2)',
      payload: [{ kind: 'table', columns: ['a', 'b'], rows: [] }],
    });
    const entry = useConsoleStore.getState().entries[0]!;
    expect(entry.content).toBe('Table(2×2)');
    expect(entry.payload).toBeDefined();
    expect(entry.payload![0]).toMatchObject({ kind: 'table' });
  });

  it('keeps payload undefined when the runner does not supply one', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'plain' });
    const entry = useConsoleStore.getState().entries[0]!;
    expect(entry.payload).toBeUndefined();
  });

  // --- store-side collapse + equality hash ---

  it('stamps a stable equalityHash on each entry', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'same' });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'same' });
    const [a, b] = useConsoleStore.getState().entries;
    expect(a!.equalityHash).toBeTruthy();
    expect(a!.equalityHash).toBe(b!.equalityHash);
  });

  it('collapses consecutive identical entries into one row with a repeat count', () => {
    for (let i = 0; i < 3; i += 1) {
      useConsoleStore.getState().addEntry({ type: 'log', content: 'tick' });
    }
    const { entries, collapsedEntries } = useConsoleStore.getState();
    // Raw entries stay intact for counts / history surfaces…
    expect(entries).toHaveLength(3);
    // …while the collapsed view is a single ×3 row.
    expect(collapsedEntries).toHaveLength(1);
    expect(collapsedEntries[0]!.repeatCount).toBe(3);
    expect(collapsedEntries[0]!.entry.content).toBe('tick');
  });

  it('keeps distinct consecutive entries as separate collapsed rows', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'a' });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'b' });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'a' });
    const rows = useConsoleStore.getState().collapsedEntries;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.repeatCount === 1)).toBe(true);
  });

  it('does not collapse entries that differ only by source line', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'same', line: 1 });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'same', line: 2 });
    const rows = useConsoleStore.getState().collapsedEntries;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.entry.line)).toEqual([1, 2]);
  });

  it('does not collapse entries that differ only by type', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'same' });
    useConsoleStore.getState().addEntry({ type: 'info', content: 'same' });
    const rows = useConsoleStore.getState().collapsedEntries;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.entry.type)).toEqual(['log', 'info']);
  });

  it('does not collapse entries that differ only in payload', () => {
    useConsoleStore.getState().addEntry({
      type: 'log',
      content: 'v',
      payload: [{ kind: 'table', columns: ['a'], rows: [] }],
    });
    useConsoleStore.getState().addEntry({
      type: 'log',
      content: 'v',
      payload: [{ kind: 'table', columns: ['b'], rows: [] }],
    });
    const rows = useConsoleStore.getState().collapsedEntries;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.entry.equalityHash).not.toBe(rows[1]!.entry.equalityHash);
  });

  it('clear resets the collapsed view too', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'x' });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'x' });
    expect(useConsoleStore.getState().collapsedEntries).toHaveLength(1);
    useConsoleStore.getState().clear();
    expect(useConsoleStore.getState().collapsedEntries).toHaveLength(0);
  });

  it('redraws a progress bar row in place and keeps its id', () => {
    const bar = (value: number) => ({ type: 'log' as const, content: `p ${value}`, payload: [{ kind: 'progress' as const, id: 'run:1', label: 'p', value }] });
    useConsoleStore.getState().addEntries([{ type: 'log', content: 'before' }, bar(0)]);
    const id = useConsoleStore.getState().entries[1]!.id;
    useConsoleStore.getState().addEntries([bar(0.4), bar(0.5), { type: 'log', content: 'after' }]);
    useConsoleStore.getState().addEntries([bar(1)]);
    const { entries, collapsedEntries } = useConsoleStore.getState();
    expect(entries.map(entry => entry.content)).toEqual(['before', 'p 1', 'after']);
    expect(entries[1]!.id).toBe(id);
    expect(collapsedEntries.map(row => row.entry.content)).toEqual(['before', 'p 1', 'after']);
    expect(collapsedEntries[1]!.entry.id).toBe(id);
  });
});
