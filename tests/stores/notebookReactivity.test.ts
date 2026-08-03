import { describe, expect, it } from 'vitest';
import type { NotebookCellV1 } from '../../src/shared/notebook';
import {
  hasNotebookExecutionEvidence,
  markExecutedNotebookCellsStale,
  restoreNotebookExecutionOrder,
  staleNotebookStatusesFromPersistedState,
} from '../../src/renderer/stores/notebookReactivity';

const cells: NotebookCellV1[] = [
  { kind: 'markdown', id: 'intro', source: '# Analysis' },
  {
    kind: 'code',
    id: 'js',
    language: 'javascript',
    source: 'const value = 2',
    outputs: [{ kind: 'text', stream: 'stdout', text: '2' }],
  },
  {
    kind: 'code',
    id: 'python',
    language: 'python',
    source: 'print("ready")',
    outputs: [],
  },
  {
    kind: 'code',
    id: 'sql',
    language: 'sql',
    source: 'select 1',
    outputs: [],
  },
];

describe('notebook lazy reactivity', () => {
  it('recognizes output, status, and execution stamps as runtime evidence', () => {
    expect(hasNotebookExecutionEvidence(cells[0]!, 'ok', 1)).toBe(false);
    expect(hasNotebookExecutionEvidence(cells[1]!, 'idle', undefined)).toBe(
      true
    );
    expect(hasNotebookExecutionEvidence(cells[2]!, 'ok', undefined)).toBe(
      true
    );
    expect(hasNotebookExecutionEvidence(cells[3]!, 'idle', 3)).toBe(true);
  });

  it('marks only executed code cells stale across language boundaries', () => {
    const result = markExecutedNotebookCellsStale(
      cells,
      { js: 'ok', python: 'ok' },
      {},
      1
    );

    expect(result).toEqual({ js: 'stale', python: 'stale' });
    expect(result.sql).toBeUndefined();
  });

  it('rehydrates persisted output and execution stamps as stale', () => {
    expect(staleNotebookStatusesFromPersistedState(cells, { sql: 7 })).toEqual(
      {
        js: 'stale',
        sql: 'stale',
      }
    );
  });

  it('returns the original status map when no executed result changes', () => {
    const status = { python: 'stale' } as const;
    expect(
      markExecutedNotebookCellsStale(cells, status, {}, 2)
    ).toBe(status);
  });

  it('restores only valid execution stamps for current code cells', () => {
    expect(
      restoreNotebookExecutionOrder(cells, {
        js: 2,
        python: 5,
        intro: 8,
        ghost: 13,
        sql: -1,
      })
    ).toEqual({ order: { js: 2, python: 5 }, maxStamp: 5 });
  });
});
