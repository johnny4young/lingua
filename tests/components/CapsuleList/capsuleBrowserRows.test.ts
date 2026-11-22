import { describe, expect, it } from 'vitest';
import {
  buildCapsuleRows,
  capsuleAnswer,
  filterCapsuleRows,
  orderForComparison,
  pinLastRun,
} from '../../../src/renderer/components/CapsuleList/capsuleBrowserRows';
import { errorNameOf } from '../../../src/renderer/utils/describeError';
import type { ExecutionHistoryEntry } from '../../../src/renderer/stores/executionHistoryStore';
import type { RunCapsuleV1 } from '../../../src/shared/runCapsule';
import {
  FIXTURE_FULL_TS,
  FIXTURE_MINIMAL_JS,
  FIXTURE_PYTHON_ERROR,
  FIXTURE_STOPPED,
  FIXTURE_TIMEOUT,
} from '../../shared/runCapsule.fixtures';

const run = (id: string, capsule: RunCapsuleV1 | undefined, timestamp: number): ExecutionHistoryEntry => ({
  id,
  language: 'javascript',
  status: 'ok',
  durationMs: 1,
  timestamp,
  snapshot: null,
  lastCapsule: capsule,
});

describe('capsule browser rows', () => {
  it('merges runs and imports newest first, skipping runs without a capsule, under one cap', () => {
    const rows = buildCapsuleRows(
      [run('a', FIXTURE_MINIMAL_JS, 1000), run('b', undefined, 2000), run('c', FIXTURE_TIMEOUT, 3000)],
      [{ id: 'imported-x', capsule: FIXTURE_FULL_TS, importedAt: 2500 }],
      2
    );
    expect(rows.map((row) => [row.id, row.result])).toEqual([
      ['c', 'timeout'],
      ['imported-x', 'not-run'],
    ]);
  });

  it('keeps same-second runs newest first', () => {
    const rows = buildCapsuleRows([run('a', FIXTURE_MINIMAL_JS, 1000), run('b', FIXTURE_FULL_TS, 1000)], [], 5);
    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('files error, timeout and stopped under Errors and imports only under All', () => {
    const rows = buildCapsuleRows(
      [
        run('ok', FIXTURE_MINIMAL_JS, 1),
        run('err', FIXTURE_PYTHON_ERROR, 2),
        run('slow', FIXTURE_TIMEOUT, 3),
        run('halt', FIXTURE_STOPPED, 4),
      ],
      [{ id: 'imp', capsule: FIXTURE_FULL_TS, importedAt: 5 }],
      20
    );
    const ids = (filter: 'all' | 'ok' | 'errors') => filterCapsuleRows(rows, '', filter).map((row) => row.id);
    expect(ids('all')).toEqual(['imp', 'halt', 'slow', 'err', 'ok']);
    expect(ids('ok')).toEqual(['ok']);
    expect(ids('errors')).toEqual(['halt', 'slow', 'err']);
  });

  it('searches the name, language and code, ignoring case and outer spaces', () => {
    const report = { ...FIXTURE_MINIMAL_JS, tab: { ...FIXTURE_MINIMAL_JS.tab, name: 'Weekly-Report.JS' } };
    const rows = buildCapsuleRows([run('js', FIXTURE_MINIMAL_JS, 1), run('ts', FIXTURE_FULL_TS, 2), run('report', report, 3)], [], 20);
    const ids = (query: string) => filterCapsuleRows(rows, query, 'all').map((row) => row.id);
    expect(ids('weekly-report')).toEqual(['report']);
    expect(ids('  DEMO.ts ')).toEqual(['ts']);
    expect(ids('typescript')).toEqual(['ts']);
    expect(ids('1 + 2')).toEqual(['report', 'js']);
    expect(ids('')).toEqual(['report', 'ts', 'js']);
  });

  it('orders a comparison older then newer whichever row came first', () => {
    const [newer, older] = buildCapsuleRows([run('a', FIXTURE_MINIMAL_JS, 1), run('b', FIXTURE_FULL_TS, 2)], [], 20);
    expect(orderForComparison(newer!, older!)).toEqual([FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS]);
    expect(orderForComparison(older!, newer!)).toEqual([FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS]);
  });

  it('reads the error name from the last traceback line or a JS message', () => {
    expect(errorNameOf('Traceback (most recent call last):\n  File "x.py", line 3\nKeyError: \'db\'')).toBe('KeyError');
    expect(errorNameOf('TypeError: Cannot read properties of undefined')).toBe('TypeError');
    expect(errorNameOf('json.decoder.JSONDecodeError: Expecting value')).toBe('JSONDecodeError');
    expect(errorNameOf('Execution stopped by user.')).toBeNull();
    expect(errorNameOf(undefined)).toBeNull();
  });

  it('answers with the status line first, then the error, the rows or the time', () => {
    expect(capsuleAnswer({ capsule: FIXTURE_MINIMAL_JS })).toEqual({ kind: 'duration', value: '3.0', unit: 'ms' });
    expect(capsuleAnswer({ capsule: FIXTURE_STOPPED })).toEqual({ kind: 'failed', name: null, status: 'stopped' });
    expect(capsuleAnswer({ capsule: FIXTURE_PYTHON_ERROR })).toEqual({ kind: 'failed', name: 'ValueError', status: 'error' });
    expect(capsuleAnswer({ capsule: FIXTURE_MINIMAL_JS, summary: { kind: 'rows', count: 12, columns: [] } })).toEqual({ kind: 'rows', count: 12 });
    expect(capsuleAnswer({ capsule: FIXTURE_PYTHON_ERROR, summary: { kind: 'http', method: 'GET', status: 500, statusText: 'Server Error', bytes: 0 } })).toEqual({
      kind: 'http', status: 500, statusText: 'Server Error',
    });
  });

  it('pins the newest own run first and leaves imports in order', () => {
    const rows = buildCapsuleRows(
      [run('a', FIXTURE_MINIMAL_JS, 1000), run('b', FIXTURE_TIMEOUT, 2000)],
      [{ id: 'imported-x', capsule: FIXTURE_FULL_TS, importedAt: 3000 }],
      5
    );
    expect(pinLastRun(rows)).toMatchObject({ lastRunId: 'b' });
    expect(pinLastRun(rows).rows.map((row) => row.id)).toEqual(['b', 'imported-x', 'a']);
    expect(pinLastRun(rows.filter((row) => row.kind === 'imported'))).toMatchObject({ lastRunId: null });
  });
});
