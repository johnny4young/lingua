/**
 * RL-043 Slice A — `useNotebookStore` CRUD + rehydrate coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/runners', () => ({
  runnerManager: {
    execute: vi.fn(),
    stop: vi.fn(),
  },
}));

import {
  resetNotebookStoreForTests,
  useNotebookStore,
} from '../../src/renderer/stores/notebookStore';
import {
  getNotebookSessionKeys,
  resetNotebookSessionsForTests,
  runNotebookCell,
} from '../../src/renderer/runtime/notebookSession';
import { runnerManager } from '../../src/renderer/runners';
import { MAX_CELLS_PER_NOTEBOOK } from '../../src/shared/notebook';

const mockExecute = runnerManager.execute as unknown as ReturnType<typeof vi.fn>;

describe('useNotebookStore CRUD', () => {
  beforeEach(() => {
    resetNotebookStoreForTests();
    resetNotebookSessionsForTests();
    mockExecute.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    resetNotebookStoreForTests();
    resetNotebookSessionsForTests();
    localStorage.clear();
  });

  it('createNotebookForTab seeds a fresh notebook + is idempotent', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-1', 'Hello');
    const first = store.getNotebookForTab('tab-1');
    expect(first?.title).toBe('Hello');
    // Idempotent — second call must NOT overwrite the existing notebook.
    useNotebookStore.getState().createNotebookForTab('tab-1', 'Different');
    expect(useNotebookStore.getState().getNotebookForTab('tab-1')?.title).toBe(
      'Hello'
    );
  });

  it('installImportedNotebook overwrites a tab with a parsed notebook, lossless (RL-043 Slice E)', () => {
    const store = useNotebookStore.getState();
    // Seed a blank notebook then install an imported one over it.
    store.createNotebookForTab('tab-imp', 'Blank');
    useNotebookStore.getState().installImportedNotebook(
      'tab-imp',
      {
        version: 1,
        id: 'nb-imported',
        title: 'Imported',
        createdAt: '2026-06-20T00:00:00.000Z',
        cells: [
          { kind: 'markdown', id: 'm1', source: '# Hi' },
          { kind: 'code', id: 'c1', language: 'typescript', source: 'const a = 1;', outputs: [] },
        ],
      },
      { c1: 5, ghost: 2 }
    );
    const installed = useNotebookStore.getState().getNotebookForTab('tab-imp');
    // The document's own ids / title survive (no regeneration).
    expect(installed?.id).toBe('nb-imported');
    expect(installed?.title).toBe('Imported');
    expect(installed?.cells.map((c) => c.id)).toEqual(['m1', 'c1']);
    // Execution order restored + counter resumed past the max stamp;
    // the unknown cell id is dropped.
    expect(useNotebookStore.getState().getCellExecutionOrder('tab-imp', 'c1')).toBe(5);
    expect(useNotebookStore.getState().getCellExecutionOrder('tab-imp', 'ghost')).toBeNull();
    expect(useNotebookStore.getState().notebooks['tab-imp']?.executionCounter).toBe(5);
    expect(useNotebookStore.getState().getActiveCellId('tab-imp')).toBe('m1');
  });

  it('createNotebookForTab can seed the starter code cell as TypeScript', () => {
    useNotebookStore
      .getState()
      .createNotebookForTab('tab-ts-default', 'Hello', 'typescript');

    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-ts-default')!
      .cells.find((cell) => cell.kind === 'code')!;
    expect(codeCell.kind).toBe('code');
    if (codeCell.kind !== 'code') return;
    expect(codeCell.language).toBe('typescript');
  });

  it('createNotebookForTab ignores empty tabId', () => {
    useNotebookStore.getState().createNotebookForTab('', 'X');
    expect(useNotebookStore.getState().notebooks).toEqual({});
  });

  it('disposeNotebookForTab drops the entry', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-2');
    store.disposeNotebookForTab('tab-2');
    expect(useNotebookStore.getState().getNotebookForTab('tab-2')).toBeUndefined();
  });

  it('renameNotebookForTab updates the persisted notebook title', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-title', 'Before');
    store.renameNotebookForTab('tab-title', '  After  ');
    expect(
      useNotebookStore.getState().getNotebookForTab('tab-title')?.title
    ).toBe('After');
  });

  it('addCell appends a code cell after the given anchor', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-3');
    const anchor =
      useNotebookStore.getState().getNotebookForTab('tab-3')!.cells[0]!.id;
    const newId = useNotebookStore
      .getState()
      .addCell('tab-3', anchor, { kind: 'code', language: 'javascript' });
    expect(typeof newId).toBe('string');
    const cells = useNotebookStore.getState().getNotebookForTab('tab-3')!.cells;
    expect(cells).toHaveLength(3);
    expect(cells[1]?.id).toBe(newId);
  });

  it('addCell respects MAX_CELLS_PER_NOTEBOOK cap', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-4');
    // Seed cells up to the cap (notebook already starts with 2 cells).
    for (let i = 0; i < MAX_CELLS_PER_NOTEBOOK - 2; i++) {
      useNotebookStore
        .getState()
        .addCell('tab-4', null, { kind: 'markdown' });
    }
    expect(
      useNotebookStore.getState().getNotebookForTab('tab-4')!.cells
    ).toHaveLength(MAX_CELLS_PER_NOTEBOOK);
    const overflow = useNotebookStore
      .getState()
      .addCell('tab-4', null, { kind: 'markdown' });
    expect(overflow).toBeNull();
  });

  it('removeCell drops the cell + clears its run status', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-5');
    const target =
      useNotebookStore.getState().getNotebookForTab('tab-5')!.cells[1]!.id;
    useNotebookStore.getState().setCellRunStatus('tab-5', target, 'ok');
    useNotebookStore.getState().removeCell('tab-5', target);
    expect(
      useNotebookStore.getState().getNotebookForTab('tab-5')!.cells
    ).toHaveLength(1);
    expect(useNotebookStore.getState().getCellRunStatus('tab-5', target)).toBe(
      'idle'
    );
  });

  it('updateCellSource clamps overflowed paste to MAX_CELL_SOURCE_LENGTH', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-6');
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-6')!
      .cells.find((c) => c.kind === 'code')!;
    const huge = 'x'.repeat(200_000);
    useNotebookStore.getState().updateCellSource('tab-6', codeCell.id, huge);
    const after = useNotebookStore
      .getState()
      .getNotebookForTab('tab-6')!
      .cells.find((c) => c.id === codeCell.id)!;
    expect(after.source.length).toBeLessThanOrEqual(32 * 1024);
  });

  it('setCellLanguage switches a code cell language + clears its outputs and run state', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-lang');
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-lang')!
      .cells.find((c) => c.kind === 'code')!;
    store.setCellOutputs('tab-lang', codeCell.id, [
      { kind: 'text', stream: 'stdout', text: 'stale' },
    ]);
    store.setCellRunStatus('tab-lang', codeCell.id, 'ok');
    store.setCellLanguage('tab-lang', codeCell.id, 'typescript');
    const after = useNotebookStore
      .getState()
      .getNotebookForTab('tab-lang')!
      .cells.find((c) => c.id === codeCell.id)!;
    expect(after.kind).toBe('code');
    if (after.kind !== 'code') return;
    expect(after.language).toBe('typescript');
    expect(after.outputs).toEqual([]);
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-lang', codeCell.id)
    ).toBe('idle');

    store.setCellLanguage('tab-lang', codeCell.id, 'python');
    const afterUnsupported = useNotebookStore
      .getState()
      .getNotebookForTab('tab-lang')!
      .cells.find((c) => c.id === codeCell.id)!;
    expect(afterUnsupported.kind).toBe('code');
    if (afterUnsupported.kind !== 'code') return;
    expect(afterUnsupported.language).toBe('typescript');
  });

  it('setCellLanguage is a no-op on a markdown cell', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-lang2');
    const markdownCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-lang2')!
      .cells.find((c) => c.kind === 'markdown')!;
    const before = useNotebookStore.getState().getNotebookForTab('tab-lang2');
    store.setCellLanguage('tab-lang2', markdownCell.id, 'typescript');
    // A no-op returns the identical state object (no re-render).
    expect(useNotebookStore.getState().getNotebookForTab('tab-lang2')).toBe(
      before
    );
  });

  it('moveCell reorders inside the cells array', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-7');
    const before = useNotebookStore.getState().getNotebookForTab('tab-7')!.cells.map((c) => c.id);
    useNotebookStore.getState().moveCell('tab-7', 0, 1);
    const after = useNotebookStore.getState().getNotebookForTab('tab-7')!.cells.map((c) => c.id);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  it('moveCell ignores out-of-bound indices', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-8');
    const before = useNotebookStore.getState().getNotebookForTab('tab-8')!.cells.map((c) => c.id);
    useNotebookStore.getState().moveCell('tab-8', 5, 0);
    const after = useNotebookStore.getState().getNotebookForTab('tab-8')!.cells.map((c) => c.id);
    expect(after).toEqual(before);
  });

  it('setCellOutputs writes outputs and caps at MAX_OUTPUTS_PER_CELL', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-9');
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-9')!
      .cells.find((c) => c.kind === 'code')!;
    const outputs = Array.from({ length: 100 }, (_, i) => ({
      kind: 'text' as const,
      text: String(i),
      stream: 'stdout' as const,
    }));
    useNotebookStore.getState().setCellOutputs('tab-9', codeCell.id, outputs);
    const stored = useNotebookStore
      .getState()
      .getNotebookForTab('tab-9')!
      .cells.find((c) => c.id === codeCell.id);
    if (stored?.kind === 'code') {
      expect(stored.outputs.length).toBeLessThanOrEqual(50);
    } else {
      throw new Error('expected code cell');
    }
  });

  it('setCellRunStatus rejects values outside NOTEBOOK_CELL_RUN_STATUSES', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-10');
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-10')!
      .cells.find((c) => c.kind === 'code')!;
    // @ts-expect-error — testing runtime guard.
    useNotebookStore.getState().setCellRunStatus('tab-10', codeCell.id, 'haunted');
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-10', codeCell.id)
    ).toBe('idle');
  });

  it('setActiveCell flips the active cell id', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-11');
    const cells = useNotebookStore.getState().getNotebookForTab('tab-11')!.cells;
    useNotebookStore.getState().setActiveCell('tab-11', cells[1]!.id);
    expect(useNotebookStore.getState().getActiveCellId('tab-11')).toBe(
      cells[1]!.id
    );
  });

  it('rehydrate drops a corrupt entry but keeps the valid one', () => {
    localStorage.setItem(
      'lingua-notebook-state',
      JSON.stringify({
        state: {
          notebooks: {
            'tab-good': {
              notebook: {
                version: 1,
                id: 'nb-good',
                title: 'OK',
                cells: [{ kind: 'markdown', id: 'cell-md', source: '# Hi' }],
              },
              cellRunStatus: { 'cell-md': 'ok' }, // transient — should reset
              activeCellId: 'cell-md',
            },
            'tab-bad': { notebook: { broken: true } },
          },
        },
        version: 1,
      })
    );
    // Trigger rehydrate.
    useNotebookStore.persist.rehydrate();
    const state = useNotebookStore.getState().notebooks;
    expect(Object.keys(state)).toEqual(['tab-good']);
    expect(state['tab-good']?.cellRunStatus).toEqual({});
  });

  // ------- Signal-Slate: execution count ----------------------------------

  it('setCellExecutionOrder assigns a monotonic per-tab [N] counter', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-exec');
    const cells = useNotebookStore.getState().getNotebookForTab('tab-exec')!.cells;
    const a = cells[0]!.id;
    const b = cells[1]!.id;
    expect(useNotebookStore.getState().getCellExecutionOrder('tab-exec', a)).toBeNull();
    useNotebookStore.getState().setCellExecutionOrder('tab-exec', a);
    useNotebookStore.getState().setCellExecutionOrder('tab-exec', b);
    // Re-running cell a earns the NEXT number, not its old one.
    useNotebookStore.getState().setCellExecutionOrder('tab-exec', a);
    expect(useNotebookStore.getState().getCellExecutionOrder('tab-exec', b)).toBe(2);
    expect(useNotebookStore.getState().getCellExecutionOrder('tab-exec', a)).toBe(3);
  });

  it('setCellExecutionOrder ignores an unknown cell id', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-exec-bad');
    useNotebookStore.getState().setCellExecutionOrder('tab-exec-bad', 'nope');
    const cells = useNotebookStore.getState().getNotebookForTab('tab-exec-bad')!.cells;
    // Counter never advanced — the first real cell still earns [1].
    useNotebookStore.getState().setCellExecutionOrder('tab-exec-bad', cells[0]!.id);
    expect(
      useNotebookStore.getState().getCellExecutionOrder('tab-exec-bad', cells[0]!.id)
    ).toBe(1);
  });

  // ------- Signal-Slate: clear outputs ------------------------------------

  it('clearAllOutputs empties every code cell but keeps the cells', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-clear');
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-clear')!
      .cells.find((c) => c.kind === 'code')!;
    useNotebookStore.getState().setCellOutputs('tab-clear', codeCell.id, [
      { kind: 'text', text: 'hi', stream: 'stdout' },
    ]);
    useNotebookStore.getState().clearAllOutputs('tab-clear');
    const after = useNotebookStore.getState().getNotebookForTab('tab-clear')!;
    expect(after.cells).toHaveLength(2);
    const cleared = after.cells.find((c) => c.id === codeCell.id);
    if (cleared?.kind === 'code') {
      expect(cleared.outputs).toEqual([]);
    } else {
      throw new Error('expected code cell');
    }
  });

  it('clearCellOutput empties a single code cell', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-clear-one');
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-clear-one')!
      .cells.find((c) => c.kind === 'code')!;
    useNotebookStore.getState().setCellOutputs('tab-clear-one', codeCell.id, [
      { kind: 'text', text: 'hi', stream: 'stdout' },
    ]);
    useNotebookStore.getState().clearCellOutput('tab-clear-one', codeCell.id);
    const cleared = useNotebookStore
      .getState()
      .getNotebookForTab('tab-clear-one')!
      .cells.find((c) => c.id === codeCell.id);
    if (cleared?.kind === 'code') {
      expect(cleared.outputs).toEqual([]);
    } else {
      throw new Error('expected code cell');
    }
  });

  // ------- Signal-Slate: restart session ----------------------------------

  it('restartNotebookSession clears outputs + transient state + disposes the sandbox', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: ['hi'], stderr: [], sessionDelta: { x: 42 } },
      stdout: [],
      stderr: [],
    });
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-restart');
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-restart')!
      .cells.find((c) => c.kind === 'code')!;
    // Populate the runtime sandbox + transient store state.
    await runNotebookCell({
      tabId: 'tab-restart',
      language: 'javascript',
      source: 'const x = 42;',
    });
    useNotebookStore.getState().setCellOutputs('tab-restart', codeCell.id, [
      { kind: 'text', text: 'hi', stream: 'stdout' },
    ]);
    useNotebookStore.getState().setCellRunStatus('tab-restart', codeCell.id, 'ok');
    useNotebookStore.getState().setCellDurationMs('tab-restart', codeCell.id, 5);
    useNotebookStore.getState().setCellExecutionOrder('tab-restart', codeCell.id);
    expect(getNotebookSessionKeys('tab-restart')).toContain('x');

    useNotebookStore.getState().restartNotebookSession('tab-restart');

    const slice = useNotebookStore.getState().notebooks['tab-restart']!;
    const cleared = slice.notebook.cells.find((c) => c.id === codeCell.id);
    if (cleared?.kind === 'code') {
      expect(cleared.outputs).toEqual([]);
    } else {
      throw new Error('expected code cell');
    }
    expect(slice.cellRunStatus).toEqual({});
    expect(slice.cellDurationMs).toEqual({});
    expect(slice.cellExecutionOrder).toEqual({});
    expect(slice.executionCounter).toBe(0);
    // Sandbox disposal runs via a lazy `import('../runtime/notebookSession')`
    // (keeps the runner/esbuild-wasm chain out of notebookStore's static
    // graph), so it settles a few ticks after the synchronous state reset.
    // Poll until the dynamic import + chained `disposeNotebookSession` land.
    await vi.waitFor(() => {
      // Sandbox disposed — `x` from the earlier run is gone.
      expect(getNotebookSessionKeys('tab-restart')).toEqual([]);
    });
  });

  // ------- Signal-Slate: transformCell ------------------------------------

  it('transformCell toggles code → markdown preserving the source text', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-xform');
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-xform')!
      .cells.find((c) => c.kind === 'code')!;
    const originalSource = codeCell.source;
    useNotebookStore.getState().transformCell('tab-xform', codeCell.id, 'markdown');
    const after = useNotebookStore
      .getState()
      .getNotebookForTab('tab-xform')!
      .cells.find((c) => c.id === codeCell.id)!;
    expect(after.kind).toBe('markdown');
    expect(after.id).toBe(codeCell.id);
    expect(after.source).toBe(originalSource);
  });

  it('transformCell toggles markdown → code preserving source + seeding JS', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-xform2');
    const mdCell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-xform2')!
      .cells.find((c) => c.kind === 'markdown')!;
    const originalSource = mdCell.source;
    const originalIndex = useNotebookStore
      .getState()
      .getNotebookForTab('tab-xform2')!
      .cells.findIndex((c) => c.id === mdCell.id);
    useNotebookStore.getState().transformCell('tab-xform2', mdCell.id, 'code');
    const after = useNotebookStore
      .getState()
      .getNotebookForTab('tab-xform2')!
      .cells.find((c) => c.id === mdCell.id)!;
    expect(after.kind).toBe('code');
    expect(after.source).toBe(originalSource);
    expect(after.id).toBe(mdCell.id);
    if (after.kind === 'code') {
      expect(after.language).toBe('javascript');
      expect(after.outputs).toEqual([]);
    }
    // Position preserved.
    const afterIndex = useNotebookStore
      .getState()
      .getNotebookForTab('tab-xform2')!
      .cells.findIndex((c) => c.id === mdCell.id);
    expect(afterIndex).toBe(originalIndex);
  });

  it('transformCell is a no-op when the kind already matches', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-xform3');
    const before = useNotebookStore.getState().getNotebookForTab('tab-xform3')!;
    const mdCell = before.cells.find((c) => c.kind === 'markdown')!;
    useNotebookStore.getState().transformCell('tab-xform3', mdCell.id, 'markdown');
    expect(useNotebookStore.getState().getNotebookForTab('tab-xform3')).toBe(
      before
    );
  });

  // ------- Signal-Slate: soft delete + undo --------------------------------

  it('undoDeleteCell re-inserts the last deleted cell at its original index', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-undo');
    const before = useNotebookStore.getState().getNotebookForTab('tab-undo')!.cells;
    const target = before[1]!; // the code cell at index 1
    useNotebookStore.getState().removeCell('tab-undo', target.id);
    expect(
      useNotebookStore.getState().getNotebookForTab('tab-undo')!.cells
    ).toHaveLength(1);
    useNotebookStore.getState().undoDeleteCell('tab-undo');
    const after = useNotebookStore.getState().getNotebookForTab('tab-undo')!.cells;
    expect(after).toHaveLength(2);
    expect(after[1]?.id).toBe(target.id);
    expect(after[1]?.source).toBe(target.source);
    // Active cell follows the restored cell.
    expect(useNotebookStore.getState().getActiveCellId('tab-undo')).toBe(target.id);
  });

  it('undoDeleteCell is a one-shot — a second undo restores nothing', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-undo2');
    const target = useNotebookStore.getState().getNotebookForTab('tab-undo2')!.cells[1]!;
    useNotebookStore.getState().removeCell('tab-undo2', target.id);
    useNotebookStore.getState().undoDeleteCell('tab-undo2');
    const restored = useNotebookStore.getState().getNotebookForTab('tab-undo2')!.cells;
    // Second undo no-ops (buffer consumed).
    useNotebookStore.getState().undoDeleteCell('tab-undo2');
    expect(
      useNotebookStore.getState().getNotebookForTab('tab-undo2')!.cells
    ).toHaveLength(restored.length);
  });

  it('removeCell keeps only the MOST RECENT delete in the undo buffer', () => {
    const store = useNotebookStore.getState();
    store.createNotebookForTab('tab-undo3');
    const cells = useNotebookStore.getState().getNotebookForTab('tab-undo3')!.cells;
    const first = cells[0]!;
    const second = cells[1]!;
    useNotebookStore.getState().removeCell('tab-undo3', first.id);
    useNotebookStore.getState().removeCell('tab-undo3', second.id);
    // Only the second delete is restorable.
    useNotebookStore.getState().undoDeleteCell('tab-undo3');
    const after = useNotebookStore.getState().getNotebookForTab('tab-undo3')!.cells;
    expect(after.some((c) => c.id === second.id)).toBe(true);
    expect(after.some((c) => c.id === first.id)).toBe(false);
  });
});
