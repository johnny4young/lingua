import { describe, expect, it } from 'vitest';
import type { RunCapsuleV1 } from '../../src/shared/runCapsule';
import {
  buildRunCompareRecord,
  RUN_COMPARE_CODE_MAX_CHARS,
  RUN_COMPARE_MAX_VALUES,
  RUN_COMPARE_STREAM_MAX_CHARS,
  RUN_COMPARE_VALUE_MAX_CHARS,
} from '../../src/renderer/utils/runCompareRecord';

function capsule(result: Partial<RunCapsuleV1['result']>, content = 'const a = 1;'): RunCapsuleV1 {
  return {
    tab: { name: 'Sorting.js', language: 'javascript', runtimeMode: 'worker', workflowMode: 'run' },
    source: { content },
    result: { status: 'success', durationMs: 3, ...result },
  } as unknown as RunCapsuleV1;
}

describe('run compare record', () => {
  it('keeps code, output, inline values and exit from the capsule', () => {
    const record = buildRunCompareRecord(
      capsule({ stdout: 'QuickSort: [1, 2]\n', stderr: 'warn', lineResults: [{ line: 3, value: '6', type: 'result' }] })
    );
    expect(record).toEqual({
      name: 'Sorting.js',
      language: 'javascript',
      runtime: 'worker',
      code: 'const a = 1;',
      stdout: 'QuickSort: [1, 2]\n',
      stderr: 'warn',
      truncated: false,
      values: [{ line: 3, value: '6' }],
      exit: 'success',
    });
  });

  it('caps code, each stream, the value list and each value', () => {
    const lineResults = Array.from({ length: RUN_COMPARE_MAX_VALUES + 5 }, (_, line) => ({ line, value: 'x'.repeat(RUN_COMPARE_VALUE_MAX_CHARS + 9) }));
    const record = buildRunCompareRecord(
      capsule({ stdout: 'o'.repeat(RUN_COMPARE_STREAM_MAX_CHARS + 1), lineResults }, 'c'.repeat(RUN_COMPARE_CODE_MAX_CHARS + 1))
    );
    expect(record.code).toHaveLength(RUN_COMPARE_CODE_MAX_CHARS);
    expect(record.stdout).toHaveLength(RUN_COMPARE_STREAM_MAX_CHARS);
    expect(record.truncated).toBe(true);
    expect(record.values).toHaveLength(RUN_COMPARE_MAX_VALUES);
    expect(record.values[0]!.value).toHaveLength(RUN_COMPARE_VALUE_MAX_CHARS);
  });

  it('skips malformed inline values and keeps a summary and the error line', () => {
    const record = buildRunCompareRecord(
      capsule({ status: 'error', errorMessage: 'TypeError: boom', lineResults: [null, { line: 'a', value: 'x' }, { line: 2, value: 4 }] }),
      { kind: 'rows', count: 3, columns: ['city'] }
    );
    expect(record.values).toEqual([]);
    expect(record.exit).toBe('error');
    expect(record.errorMessage).toBe('TypeError: boom');
    expect(record.summary).toEqual({ kind: 'rows', count: 3, columns: ['city'] });
  });
});
