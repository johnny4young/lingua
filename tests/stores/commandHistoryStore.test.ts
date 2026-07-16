/**
 * RL-113 Slice 1 — the per-session recent-commands ring buffer.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_COMMAND_HISTORY_ENTRIES,
  useCommandHistoryStore,
} from '../../src/renderer/stores/commandHistoryStore';

beforeEach(() => {
  useCommandHistoryStore.getState()._clearForTesting();
});

describe('commandHistoryStore', () => {
  it('records newest first', () => {
    const { recordCommand } = useCommandHistoryStore.getState();
    recordCommand('action-a');
    recordCommand('action-b');
    recordCommand('action-c');
    expect(useCommandHistoryStore.getState().entries.map(e => e.id)).toEqual([
      'action-c',
      'action-b',
      'action-a',
    ]);
  });

  it('re-running a command moves it to the top instead of duplicating', () => {
    const { recordCommand } = useCommandHistoryStore.getState();
    recordCommand('action-a');
    recordCommand('action-b');
    recordCommand('action-a');
    expect(useCommandHistoryStore.getState().entries.map(e => e.id)).toEqual([
      'action-a',
      'action-b',
    ]);
  });

  it('never exceeds the 20-entry cap (FIFO eviction)', () => {
    const { recordCommand } = useCommandHistoryStore.getState();
    for (let index = 0; index < MAX_COMMAND_HISTORY_ENTRIES + 5; index += 1) {
      recordCommand(`action-${index}`);
    }
    const entries = useCommandHistoryStore.getState().entries;
    expect(entries).toHaveLength(MAX_COMMAND_HISTORY_ENTRIES);
    // Newest survives; the very first records were evicted.
    expect(entries[0]!.id).toBe(`action-${MAX_COMMAND_HISTORY_ENTRIES + 4}`);
    expect(entries.some(entry => entry.id === 'action-0')).toBe(false);
  });

  it('ignores empty ids', () => {
    useCommandHistoryStore.getState().recordCommand('');
    expect(useCommandHistoryStore.getState().entries).toHaveLength(0);
  });
});
