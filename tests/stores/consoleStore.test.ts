import { describe, it, expect, beforeEach } from 'vitest';
import { useConsoleStore } from '@/stores/consoleStore';

describe('consoleStore', () => {
  beforeEach(() => {
    useConsoleStore.setState({
      entries: [],
      collapsedEntries: [],
      activeFilters: new Set(['log', 'info', 'warn', 'error', 'result']),
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

  // implementation note — `clear` also resets the payload-kind
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

  it('should assign unique IDs to each entry', () => {
    useConsoleStore.getState().addEntry({ type: 'log', content: 'A' });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'B' });

    const state = useConsoleStore.getState();
    expect(state.entries[0].id).not.toBe(state.entries[1].id);
  });

  // --- Filter tests ---

  it('should start with all types in activeFilters', () => {
    const { activeFilters } = useConsoleStore.getState();
    expect(activeFilters.has('log')).toBe(true);
    expect(activeFilters.has('info')).toBe(true);
    expect(activeFilters.has('warn')).toBe(true);
    expect(activeFilters.has('error')).toBe(true);
    expect(activeFilters.has('result')).toBe(true);
  });

  it('should remove a filter when toggled off', () => {
    useConsoleStore.getState().toggleFilter('warn');
    expect(useConsoleStore.getState().activeFilters.has('warn')).toBe(false);
  });

  it('should add a filter back when toggled on again', () => {
    useConsoleStore.getState().toggleFilter('warn');
    useConsoleStore.getState().toggleFilter('warn');
    expect(useConsoleStore.getState().activeFilters.has('warn')).toBe(true);
  });

  it('should not remove the last active filter', () => {
    const types = ['log', 'info', 'warn', 'error', 'result'] as const;
    // Toggle off all but one
    for (const t of types.slice(0, 4)) {
      useConsoleStore.getState().toggleFilter(t);
    }
    // Now only 'result' is left — trying to remove it should be a no-op
    useConsoleStore.getState().toggleFilter('result');
    expect(useConsoleStore.getState().activeFilters.has('result')).toBe(true);
    expect(useConsoleStore.getState().activeFilters.size).toBe(1);
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

  // --- implementation note — payload-kind filter tests ---

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

  // --- implementation — additive payload field on entries ---

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

  // --- implementation detail — store-side collapse + equality hash ---

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
});
