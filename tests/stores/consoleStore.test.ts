import { describe, it, expect, beforeEach } from 'vitest';
import { useConsoleStore } from '@/stores/consoleStore';

describe('consoleStore', () => {
  beforeEach(() => {
    useConsoleStore.setState({ entries: [] });
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
});
