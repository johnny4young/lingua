import { describe, expect, it } from 'vitest';
import {
  diffSnapshot,
  resolveCompareTargetSnapshot,
} from '../../src/renderer/utils/snapshotDiff';
import type { ResultSnapshot } from '../../src/renderer/stores/resultStore';

function snapshot(
  partial: Partial<ResultSnapshot> & { language: string }
): ResultSnapshot {
  return {
    lineResults: [],
    fullOutput: '',
    stdinConsumed: null,
    executionTime: 42,
    capturedAt: 1_000,
    ...partial,
  };
}

describe('implementation — diffSnapshot', () => {
  describe('dynamic mode', () => {
    it('flags identical snapshots as identical', () => {
      const result = diffSnapshot({
        snapshot: snapshot({
          language: 'javascript',
          lineResults: [
            { line: 1, value: '2', type: 'result' },
            { line: 2, value: '4', type: 'result' },
          ],
        }),
        current: {
          lineResults: [
            { line: 1, value: '2', type: 'result' },
            { line: 2, value: '4', type: 'result' },
          ],
          fullOutput: '',
        },
      });
      expect(result.mode).toBe('dynamic');
      if (result.mode !== 'dynamic') return;
      expect(result.identical).toBe(true);
      expect(result.rows.every((row) => row.kind === 'unchanged')).toBe(true);
    });

    it('detects an added line in current', () => {
      const result = diffSnapshot({
        snapshot: snapshot({
          language: 'javascript',
          lineResults: [{ line: 1, value: '2', type: 'result' }],
        }),
        current: {
          lineResults: [
            { line: 1, value: '2', type: 'result' },
            { line: 2, value: '4', type: 'result' },
          ],
          fullOutput: '',
        },
      });
      if (result.mode !== 'dynamic') throw new Error('expected dynamic mode');
      expect(result.identical).toBe(false);
      const addedRow = result.rows.find((row) => row.kind === 'added');
      expect(addedRow?.line).toBe(2);
      expect(addedRow?.current).toBe('4');
      expect(addedRow?.previous).toBeNull();
    });

    it('detects a removed line', () => {
      const result = diffSnapshot({
        snapshot: snapshot({
          language: 'javascript',
          lineResults: [
            { line: 1, value: '2', type: 'result' },
            { line: 2, value: '4', type: 'result' },
          ],
        }),
        current: {
          lineResults: [{ line: 1, value: '2', type: 'result' }],
          fullOutput: '',
        },
      });
      if (result.mode !== 'dynamic') throw new Error('expected dynamic mode');
      const removedRow = result.rows.find((row) => row.kind === 'removed');
      expect(removedRow?.line).toBe(2);
      expect(removedRow?.previous).toBe('4');
      expect(removedRow?.current).toBeNull();
    });

    it('detects a changed line', () => {
      const result = diffSnapshot({
        snapshot: snapshot({
          language: 'javascript',
          lineResults: [{ line: 1, value: '2', type: 'result' }],
        }),
        current: {
          lineResults: [{ line: 1, value: '4', type: 'result' }],
          fullOutput: '',
        },
      });
      if (result.mode !== 'dynamic') throw new Error('expected dynamic mode');
      expect(result.rows[0]?.kind).toBe('changed');
      expect(result.rows[0]?.previous).toBe('2');
      expect(result.rows[0]?.current).toBe('4');
    });

    it('sorts rows by line number', () => {
      const result = diffSnapshot({
        snapshot: snapshot({
          language: 'javascript',
          lineResults: [
            { line: 5, value: 'a', type: 'result' },
            { line: 1, value: 'b', type: 'result' },
          ],
        }),
        current: {
          lineResults: [
            { line: 5, value: 'a', type: 'result' },
            { line: 1, value: 'b', type: 'result' },
          ],
          fullOutput: '',
        },
      });
      if (result.mode !== 'dynamic') throw new Error('expected dynamic mode');
      expect(result.rows.map((row) => row.line)).toEqual([1, 5]);
    });
  });

  describe('compiled mode', () => {
    it('flags identical fullOutput as identical', () => {
      const result = diffSnapshot({
        snapshot: snapshot({
          language: 'go',
          fullOutput: 'hello\nworld',
        }),
        current: { lineResults: [], fullOutput: 'hello\nworld' },
      });
      expect(result.mode).toBe('compiled');
      if (result.mode !== 'compiled') return;
      expect(result.identical).toBe(true);
    });

    it('produces unified segments when outputs diverge', () => {
      const result = diffSnapshot({
        snapshot: snapshot({
          language: 'go',
          fullOutput: 'hello',
        }),
        current: { lineResults: [], fullOutput: 'world' },
      });
      if (result.mode !== 'compiled') throw new Error('expected compiled mode');
      expect(result.identical).toBe(false);
      const adds = result.segments.filter((segment) => segment.kind === 'add');
      const removes = result.segments.filter(
        (segment) => segment.kind === 'remove'
      );
      expect(adds.length).toBeGreaterThan(0);
      expect(removes.length).toBeGreaterThan(0);
    });

    it('honors granularity override', () => {
      const result = diffSnapshot({
        snapshot: snapshot({
          language: 'rust',
          fullOutput: 'one two three',
        }),
        current: { lineResults: [], fullOutput: 'one two four' },
        granularity: 'word',
      });
      if (result.mode !== 'compiled') throw new Error('expected compiled mode');
      expect(result.granularity).toBe('word');
    });
  });

  describe('compare target resolution', () => {
    it('defaults to the previous stable snapshot when the newest matches current output', () => {
      const previous = snapshot({
        language: 'javascript',
        capturedAt: 1_000,
        lineResults: [{ line: 1, value: '2', type: 'result' }],
      });
      const newest = snapshot({
        language: 'javascript',
        capturedAt: 2_000,
        lineResults: [{ line: 1, value: '4', type: 'result' }],
      });

      const target = resolveCompareTargetSnapshot({
        snapshotRing: [previous, newest],
        language: 'javascript',
        selectedCapturedAt: null,
        current: {
          lineResults: [{ line: 1, value: '4', type: 'result' }],
          fullOutput: '',
        },
      });

      expect(target?.capturedAt).toBe(1_000);
    });

    it('honors an explicitly selected comparator even when newest matches current', () => {
      const previous = snapshot({
        language: 'javascript',
        capturedAt: 1_000,
        lineResults: [{ line: 1, value: '2', type: 'result' }],
      });
      const newest = snapshot({
        language: 'javascript',
        capturedAt: 2_000,
        lineResults: [{ line: 1, value: '4', type: 'result' }],
      });

      const target = resolveCompareTargetSnapshot({
        snapshotRing: [previous, newest],
        language: 'javascript',
        selectedCapturedAt: 2_000,
        current: {
          lineResults: [{ line: 1, value: '4', type: 'result' }],
          fullOutput: '',
        },
      });

      expect(target?.capturedAt).toBe(2_000);
    });
  });
});
