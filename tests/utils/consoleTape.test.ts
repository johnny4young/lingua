import { describe, expect, it } from 'vitest';
import {
  entryMatchesLevel,
  formatRunOffset,
  pendingFromPreviousRun,
  sourceSnippet,
} from '../../src/renderer/utils/consoleTape';
import type { CollapsedConsoleRow } from '../../src/renderer/types/console';

function row(id: string, line: number | undefined, repeatCount = 1): CollapsedConsoleRow {
  return {
    entry: { id, type: 'log', content: id, timestamp: 0, ...(line ? { line } : {}) },
    repeatCount,
  };
}

describe('pendingFromPreviousRun', () => {
  const previous = [row('api', 25), row('worker', 25), row('db', 25), row('slowest', 27)];

  it('waits on the next unmatched line and ghosts later lines not reached yet', () => {
    const pending = pendingFromPreviousRun([row('api-now', 25), row('worker-now', 25)], previous);
    expect(pending.waitingLine).toBe(25);
    expect(pending.ghosts.map(ghost => ghost.entry.id)).toEqual(['slowest']);
  });

  it('keeps every previous row pending before the run prints anything', () => {
    const pending = pendingFromPreviousRun([], previous);
    expect(pending.waitingLine).toBe(25);
    expect(pending.ghosts.map(ghost => ghost.entry.id)).toEqual(['worker', 'db', 'slowest']);
  });

  it('splits a collapsed previous row by how many repeats are still owed', () => {
    const pending = pendingFromPreviousRun([row('now', 4, 2)], [row('tick', 4, 5), row('end', 9)]);
    expect(pending.waitingLine).toBe(4);
    // Line 4 is reached, so its remaining repeats are not ghosts; line 9 is.
    expect(pending.ghosts).toEqual([row('end', 9)]);
  });

  it('ghosts the leftover repeats of a line the run has not reached', () => {
    const pending = pendingFromPreviousRun([], [row('tick', 4, 3)]);
    expect(pending.waitingLine).toBe(4);
    expect(pending.ghosts).toEqual([row('tick', 4, 2)]);
  });

  it('ignores rows without a source line and clears once everything is matched', () => {
    const pending = pendingFromPreviousRun([row('a', 1), row('b', 2)], [row('info', undefined), row('a', 1), row('b', 2)]);
    expect(pending).toEqual({ waitingLine: null, ghosts: [] });
  });
});

describe('tape formatting', () => {
  it('formats offsets from the run start and rejects rows before it', () => {
    expect(formatRunOffset(1_440, 1_000)).toBe('+0.44 s');
    expect(formatRunOffset(13_000, 1_000)).toBe('+12.0 s');
    expect(formatRunOffset(201_000, 1_000)).toBe('+200 s');
    expect(formatRunOffset(900, 1_000)).toBeNull();
  });

  it('clips the waiting snippet to one row', () => {
    expect(sourceSnippet('a\n    sleep(0.4)\n', 2)).toBe('sleep(0.4)');
    expect(sourceSnippet('a\n\n', 2)).toBeNull();
    expect(sourceSnippet('x'.repeat(60), 1, 10)).toBe('xxxxxxxxx…');
  });

  it('maps info and result rows onto the Log segment', () => {
    expect(entryMatchesLevel('info', 'log')).toBe(true);
    expect(entryMatchesLevel('result', 'log')).toBe(true);
    expect(entryMatchesLevel('warn', 'log')).toBe(false);
    expect(entryMatchesLevel('error', 'error')).toBe(true);
    expect(entryMatchesLevel('warn', 'all')).toBe(true);
  });
});
