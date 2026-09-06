import { describe, expect, it, vi } from 'vitest';
import { createConsoleEntryBatcher } from '../../src/renderer/stores/consoleEntryBatcher';

describe('createConsoleEntryBatcher', () => {
  it('delivers a burst as one addEntries call, in push order, on the scheduled flush', () => {
    const addEntries = vi.fn();
    let pending: (() => void) | null = null;
    const batcher = createConsoleEntryBatcher({
      addEntries,
      schedule: (flush) => {
        pending = flush;
      },
    });

    batcher.push({ type: 'log', content: 'a' });
    batcher.push({ type: 'log', content: 'b' });
    batcher.push({ type: 'error', content: 'c' });
    expect(addEntries).not.toHaveBeenCalled();

    pending!();
    expect(addEntries).toHaveBeenCalledTimes(1);
    expect(addEntries.mock.calls[0]?.[0].map((entry: { content: string }) => entry.content)).toEqual([
      'a',
      'b',
      'c',
    ]);
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
      schedule: (flush) => {
        pending = flush;
      },
    });
    batcher.push({ type: 'log', content: 'x' });
    batcher.flush();
    pending!();
    expect(addEntries).toHaveBeenCalledTimes(1);
  });
});
