import { describe, expect, it } from 'vitest';
import { preserveStickyLineResults } from '@/hooks/autoRunStickyResults';
import type { ResultSnapshot } from '@/stores/resultStore';

function snapshot(code: string, line: number): ResultSnapshot {
  return {
    lineResults: [{ line, value: 'old', type: 'autoLog' }],
    fullOutput: '',
    stdinConsumed: null,
    executionTime: 1,
    stickySourceLines: { [`autoLog:${line}`]: code.split('\n')[line - 1] ?? '' },
    language: 'javascript',
  } as ResultSnapshot;
}

describe('preserveStickyLineResults', () => {
  const base = { autoLogEnabled: true, language: 'javascript' as const, lineResults: [] };

  it('keeps a single-line answer whose source is unchanged when the run errors elsewhere', () => {
    const previous = 'const total = 1\nnext()';
    const kept = preserveStickyLineResults({
      ...base,
      code: 'const total = 1\nnext(',
      error: { message: 'SyntaxError', line: 2 },
      previousSnapshot: snapshot(previous, 1),
    });
    expect(kept).toEqual([{ line: 1, value: 'old', type: 'autoLog' }]);
  });

  it('drops a multi-line binding answer once a line below its first changed', () => {
    const previous = 'const rows = [\n  1,\n  2,\n]';
    const kept = preserveStickyLineResults({
      ...base,
      code: 'const rows = [\n  1,\n  2 3,\n]',
      error: { message: 'SyntaxError', line: 3 },
      previousSnapshot: snapshot(previous, 1),
    });
    expect(kept).toEqual([]);
  });
});
