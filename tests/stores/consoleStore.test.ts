import { describe, it, expect, beforeEach } from 'vitest';
import { useConsoleStore } from '@/stores/consoleStore';

describe('consoleStore', () => {
  beforeEach(() => {
    useConsoleStore.setState({
      entries: [],
      activeFilters: new Set(['log', 'info', 'warn', 'error', 'result']),
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
});
