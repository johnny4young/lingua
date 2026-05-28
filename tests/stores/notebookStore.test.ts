/**
 * RL-043 Slice A — `useNotebookStore` CRUD + rehydrate coverage.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetNotebookStoreForTests,
  useNotebookStore,
} from '../../src/renderer/stores/notebookStore';
import { MAX_CELLS_PER_NOTEBOOK } from '../../src/shared/notebook';

describe('useNotebookStore CRUD', () => {
  beforeEach(() => {
    resetNotebookStoreForTests();
    localStorage.clear();
  });
  afterEach(() => {
    resetNotebookStoreForTests();
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
});
