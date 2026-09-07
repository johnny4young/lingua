import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConsoleStore } from '../../src/renderer/stores/consoleStore';
import { createConsoleEntryBatcher } from '../../src/renderer/stores/consoleEntryBatcher';

describe('createConsoleEntryBatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves emission timestamps through a delayed flush into the real store', () => {
    vi.useFakeTimers();
    useConsoleStore.getState().clear();
    const batcher = createConsoleEntryBatcher({
      addEntries: useConsoleStore.getState().addEntries,
      schedule: () => {},
    });
    vi.setSystemTime(1_000);
    batcher.push({ type: 'log', content: 'same' });
    vi.setSystemTime(2_000);
    batcher.push({ type: 'log', content: 'same' });
    vi.setSystemTime(60_000);
    batcher.flush();
    const { entries, collapsedEntries } = useConsoleStore.getState();
    expect(entries.map(entry => entry.timestamp)).toEqual([1_000, 2_000]);
    expect(collapsedEntries[0]).toMatchObject({
      entry: { timestamp: 1_000 },
      repeatCount: 2,
    });
  });

  it('delivers a burst as one addEntries call, in push order, on the scheduled flush', () => {
    const addEntries = vi.fn();
    let pending: (() => void) | null = null;
    const batcher = createConsoleEntryBatcher({
      addEntries,
      schedule: flush => {
        pending = flush;
      },
    });

    batcher.push({ type: 'log', content: 'a' });
    batcher.push({ type: 'log', content: 'b' });
    batcher.push({ type: 'error', content: 'c' });
    expect(addEntries).not.toHaveBeenCalled();

    pending!();
    expect(addEntries).toHaveBeenCalledTimes(1);
    expect(
      addEntries.mock.calls[0]?.[0].map((entry: { content: string }) => entry.content)
    ).toEqual(['a', 'b', 'c']);
  });

  it('drops a pre-clear batch on scheduled flush without needing another push', () => {
    useConsoleStore.getState().clear();
    let pending: (() => void) | undefined;
    const batcher = createConsoleEntryBatcher({
      addEntries: useConsoleStore.getState().addEntries,
      getClearVersion: () => useConsoleStore.getState().clearVersion,
      schedule: callback => {
        pending = callback;
      },
    });
    batcher.push({ type: 'log', content: 'discarded' });
    useConsoleStore.getState().clear();
    pending!();
    expect(useConsoleStore.getState().entries).toEqual([]);
    batcher.push({ type: 'log', content: 'new' });
    pending!();
    expect(useConsoleStore.getState().entries.map(entry => entry.content)).toEqual(['new']);
  });

  it('schedules once per burst and again after a flush', () => {
    const addEntries = vi.fn();
    const schedule = vi.fn();
    const batcher = createConsoleEntryBatcher({ addEntries, schedule });

    batcher.push({ type: 'log', content: '1' });
    batcher.push({ type: 'log', content: '2' });
    expect(schedule).toHaveBeenCalledTimes(1);

    batcher.flush();
    expect(addEntries).toHaveBeenCalledTimes(1);

    batcher.push({ type: 'log', content: '3' });
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it('flush() is synchronous, drains the queue and is a no-op when empty', () => {
    const addEntries = vi.fn();
    const batcher = createConsoleEntryBatcher({ addEntries, schedule: () => {} });

    batcher.flush();
    expect(addEntries).not.toHaveBeenCalled();

    batcher.push({ type: 'log', content: 'x' });
    batcher.flush();
    batcher.flush();
    expect(addEntries).toHaveBeenCalledTimes(1);
  });

  it('a late scheduled flush after an explicit flush delivers nothing twice', () => {
    const addEntries = vi.fn();
    let pending: (() => void) | null = null;
    const batcher = createConsoleEntryBatcher({
      addEntries,
      schedule: flush => {
        pending = flush;
      },
    });
    batcher.push({ type: 'log', content: 'x' });
    batcher.flush();
    pending!();
    expect(addEntries).toHaveBeenCalledTimes(1);
  });
});
