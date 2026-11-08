import { describe, expect, it } from 'vitest';
import type { ExecutionHistoryEntry } from '../../../src/renderer/stores/executionHistoryStore';
import type { RunCompareRecord } from '../../../src/renderer/utils/runCompareRecord';
import {
  compareRunRecords,
  defaultRunSelection,
  groupRunsByDay,
  RUN_COMPARE_MAX_DIFF_ROWS,
  runOutputLine,
  runRuntimeLabel,
  orderRunPair,
  toggleRunSelection,
} from '../../../src/renderer/components/RunCompare/runCompareModel';

function record(overrides: Partial<RunCompareRecord> = {}): RunCompareRecord {
  return {
    name: 'Sorting.js', language: 'javascript', runtime: 'worker', code: '', stdout: '', stderr: '',
    truncated: false, values: [], exit: 'success', ...overrides,
  };
}

function entry(id: string, timestamp: number, extra: Partial<ExecutionHistoryEntry> = {}): ExecutionHistoryEntry {
  return { id, language: 'javascript', status: 'ok', durationMs: 1, timestamp, snapshot: null, runCompare: record(), ...extra };
}

const now = new Date(2026, 9, 31, 15, 0).getTime();

describe('run compare model', () => {
  it('groups newest first by local day', () => {
    const entries = [
      entry('a', new Date(2026, 9, 28, 9).getTime()),
      entry('b', new Date(2026, 9, 30, 18).getTime()),
      entry('c', new Date(2026, 9, 31, 9).getTime()),
      entry('d', new Date(2026, 9, 31, 14).getTime()),
    ];
    const groups = groupRunsByDay(entries, now);
    expect(groups.map(group => [group.key, group.entries.map(item => item.id)])).toEqual([
      ['today', ['d', 'c']],
      ['yesterday', ['b']],
      ['earlier', ['a']],
    ]);
  });

  it('keeps two picks at most, replacing the earlier one', () => {
    expect(toggleRunSelection([], 'a')).toEqual(['a']);
    expect(toggleRunSelection(['a', 'b'], 'c')).toEqual(['b', 'c']);
    expect(toggleRunSelection(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('opens on the two newest comparable runs of the active tab', () => {
    const entries = [
      entry('a', 1, { tabId: 't1' }),
      entry('b', 2, { tabId: 't2' }),
      entry('c', 3, { tabId: 't1' }),
      entry('d', 4, { tabId: 't1', runCompare: undefined }),
      entry('e', 5, { tabId: 't1' }),
    ];
    expect(defaultRunSelection(entries, 't1')).toEqual(['c', 'e']);
    expect(defaultRunSelection(entries, 't2')).toEqual([]);
    expect(defaultRunSelection(entries, null)).toEqual([]);
    expect(orderRunPair(entries, ['e', 'a'])?.map(item => item.id)).toEqual(['a', 'e']);
    expect(orderRunPair(entries, ['d', 'a'])).toBeNull();
  });

  it('diffs code and output with unchanged runs folded', () => {
    const comparison = compareRunRecords(
      record({ code: 'a\nb\nc\nd', stdout: 'QuickSort: [1, 2]', stderr: '' }),
      record({ code: 'a\nb\nC\nd', stdout: 'QuickSort: [1, 1, 2]', stderr: 'warn' })
    );
    expect(comparison.code.rows).toEqual([
      { kind: 'same', count: 2 },
      { kind: 'remove', text: 'c' },
      { kind: 'add', text: 'C' },
      { kind: 'same', count: 1 },
    ]);
    expect(comparison.stdout.rows).toEqual([
      { kind: 'remove', text: 'QuickSort: [1, 2]' },
      { kind: 'add', text: 'QuickSort: [1, 1, 2]' },
      { kind: 'add', text: 'warn' },
    ]);
    expect(compareRunRecords(record({ code: 'x' }), record({ code: 'x' })).code).toEqual({ rows: [], changed: false, cut: false });
  });

  it('marks a diff cut at the row cap', () => {
    const older = Array.from({ length: RUN_COMPARE_MAX_DIFF_ROWS + 10 }, (_, index) => `a${index}`).join('\n');
    const newer = Array.from({ length: RUN_COMPARE_MAX_DIFF_ROWS + 10 }, (_, index) => `b${index}`).join('\n');
    const section = compareRunRecords(record({ code: older }), record({ code: newer })).code;
    expect(section.rows).toHaveLength(RUN_COMPARE_MAX_DIFF_ROWS);
    expect(section.cut).toBe(true);
  });

  it('lists inline values that changed, by line, using the last value on a line', () => {
    const comparison = compareRunRecords(
      record({ values: [{ line: 3, value: '1' }, { line: 3, value: '6' }, { line: 5, value: 'same' }, { line: 9, value: 'gone' }] }),
      record({ values: [{ line: 3, value: '7' }, { line: 5, value: 'same' }, { line: 11, value: 'new' }] })
    );
    expect(comparison.values).toEqual([
      { line: 3, before: '6', after: '7' },
      { line: 9, before: 'gone', after: undefined },
      { line: 11, before: undefined, after: 'new' },
    ]);
    expect(comparison.valuesTracked).toBe(true);
    expect(compareRunRecords(record(), record()).valuesTracked).toBe(false);
  });

  it('names the runtime and the one-line result', () => {
    expect(runRuntimeLabel(record())).toBe('Worker');
    expect(runRuntimeLabel(record({ language: 'python', runtime: 'worker' }))).toBe('');
    expect(runRuntimeLabel(record({ language: 'sql', runtime: 'duckdb-wasm' }))).toBe('DuckDB');
    expect(runRuntimeLabel(record({ language: 'sql', runtime: 'sql-libsql' }))).toBe('Turso');
    expect(
      runRuntimeLabel(record({ language: 'http', runtime: 'http-client', summary: { kind: 'http', method: 'GET', status: 200, statusText: 'OK', bytes: 1 } }))
    ).toBe('GET');
    expect(runOutputLine(record({ stdout: 'first\nlast\n\n' }))).toBe('last');
    expect(runOutputLine(record({ stdout: 'QuickSort: [\n  1,\n]\n', values: [{ line: 5, value: 'QuickSort: [ 1 ]' }, { line: 4, value: '7' }] }))).toBe('QuickSort: [ 1 ]');
  });
});
