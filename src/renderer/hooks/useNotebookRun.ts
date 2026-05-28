/**
 * RL-043 Slice A — `useNotebookRun` hook.
 *
 * Per-tab orchestration for Run cell / Run all / Run above / Stop.
 * Bypasses `useRunner` so notebook execution does NOT pollute the
 * user's regular execution history or capsule snapshots (mirror of
 * the RL-039 Slice B `useRecipeRun` pattern).
 *
 * Concurrency: Slice A blocks `'concurrent-run'` per tab. The
 * `runAll` / `runAbove` loops invoke `runNotebookCell` sequentially
 * with an early-stop when a cell errors (mirrors Jupyter's default
 * "stop on first failure" behavior).
 *
 * Stop semantics: clicking `Stop` flips `stopRequested = true` and
 * also calls `runnerManager.stop('javascript')` so the worker's
 * Promise rejects. The current cell's status becomes `'stopped'`;
 * subsequent cells in a `runAll` chain do not run.
 */

import { useCallback, useRef, useState } from 'react';
import {
  isNotebookCodeCell,
  type NotebookCellLanguage,
  type NotebookCellOutputV1,
  type NotebookV1,
} from '../../shared/notebook';
import {
  isNotebookRunnableLanguage,
  runNotebookCell,
  type NotebookCellRunOutcome,
} from '../runtime/notebookSession';
import { runnerManager } from '../runners';
import { useNotebookStore } from '../stores/notebookStore';
import { useUIStore } from '../stores/uiStore';
import { trackNotebookCellExecuted } from './notebookTelemetry';

export interface UseNotebookRunResult {
  /** True while any cell is in flight for this tab. */
  readonly isAnyCellRunning: boolean;
  /** Run a single cell by id. */
  runCell: (tabId: string, cellId: string) => Promise<void>;
  /** Run every code cell in order. Stops at first error. */
  runAll: (tabId: string) => Promise<void>;
  /** Run every cell from the top THROUGH the given cell id (inclusive). */
  runAbove: (tabId: string, cellId: string) => Promise<void>;
  /** Signal the in-flight cell + the loop to abort. */
  stop: () => void;
}

export function useNotebookRun(): UseNotebookRunResult {
  const [isAnyCellRunning, setIsAnyCellRunning] = useState(false);
  const stopRequestedRef = useRef(false);

  const runCellInternal = useCallback(
    async (
      tabId: string,
      cellId: string
    ): Promise<NotebookCellRunOutcome | null> => {
      const notebook = useNotebookStore.getState().getNotebookForTab(tabId);
      if (!notebook) return null;
      const cell = notebook.cells.find((c) => c.id === cellId);
      if (!cell || !isNotebookCodeCell(cell)) return null;
      if (!isNotebookRunnableLanguage(cell.language)) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'notebook.notice.languageNotSupported',
        });
        return null;
      }

      const store = useNotebookStore.getState();
      store.setCellRunStatus(tabId, cellId, 'running');
      setIsAnyCellRunning(true);

      try {
        const result = await runNotebookCell({
          tabId,
          language: cell.language,
          source: cell.source,
        });

        if (!result.ok) {
          if (result.reason === 'concurrent-run') {
            useUIStore.getState().pushStatusNotice({
              tone: 'warning',
              messageKey: 'notebook.notice.concurrentRun',
            });
          } else if (result.reason === 'language-not-supported') {
            useUIStore.getState().pushStatusNotice({
              tone: 'info',
              messageKey: 'notebook.notice.languageNotSupported',
            });
          } else if (result.reason === 'session-disposed') {
            useUIStore.getState().pushStatusNotice({
              tone: 'warning',
              messageKey: 'notebook.notice.sessionDisposed',
            });
          }
          store.setCellRunStatus(tabId, cellId, 'idle');
          return null;
        }

        const outcome = result.outcome;
        const outputs: NotebookCellOutputV1[] = [
          ...outcome.stdout.map<NotebookCellOutputV1>((text) => ({
            kind: 'text',
            stream: 'stdout',
            text,
          })),
          ...outcome.stderr.map<NotebookCellOutputV1>((text) => ({
            kind: 'text',
            stream: 'stderr',
            text,
          })),
        ];
        store.setCellOutputs(tabId, cellId, outputs);
        store.setCellRunStatus(tabId, cellId, outcome.status);
        trackNotebookCellExecuted({
          language: cell.language,
          status: outcome.status,
        });
        return outcome;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        store.setCellOutputs(tabId, cellId, [
          { kind: 'text', stream: 'stderr', text: message.slice(0, 16 * 1024) },
        ]);
        store.setCellRunStatus(tabId, cellId, 'error');
        trackNotebookCellExecuted({
          language: cell.language,
          status: 'error',
        });
        return { status: 'error', stdout: [], stderr: [message], sandboxKeyCount: 0 };
      } finally {
        setIsAnyCellRunning(false);
      }
    },
    []
  );

  const runCell = useCallback(
    async (tabId: string, cellId: string): Promise<void> => {
      stopRequestedRef.current = false;
      await runCellInternal(tabId, cellId);
    },
    [runCellInternal]
  );

  const runRange = useCallback(
    async (tabId: string, throughCellId: string | null): Promise<void> => {
      stopRequestedRef.current = false;
      const notebook: NotebookV1 | undefined = useNotebookStore
        .getState()
        .getNotebookForTab(tabId);
      if (!notebook) return;
      const stopIdx =
        throughCellId === null
          ? notebook.cells.length - 1
          : notebook.cells.findIndex((c) => c.id === throughCellId);
      if (stopIdx === -1) return;
      let ranRunnableCell = false;
      let skippedUnsupportedCodeCell = false;
      setIsAnyCellRunning(true);
      try {
        for (let i = 0; i <= stopIdx; i += 1) {
          if (stopRequestedRef.current) break;
          const cell = notebook.cells[i]!;
          if (cell.kind !== 'code') continue;
          if (!isNotebookRunnableLanguage(cell.language as NotebookCellLanguage)) {
            // Keep mixed-language notebooks moving, but do not let an
            // all-Python import make Run all look like a broken button.
            skippedUnsupportedCodeCell = true;
            continue;
          }
          ranRunnableCell = true;
          const outcome = await runCellInternal(tabId, cell.id);
          if (outcome === null) break;
          if (outcome.status === 'error' || outcome.status === 'stopped') break;
        }
        if (!ranRunnableCell && skippedUnsupportedCodeCell) {
          useUIStore.getState().pushStatusNotice({
            tone: 'info',
            messageKey: 'notebook.notice.languageNotSupported',
          });
        }
      } finally {
        setIsAnyCellRunning(false);
      }
    },
    [runCellInternal]
  );

  const runAll = useCallback(
    (tabId: string) => runRange(tabId, null),
    [runRange]
  );
  const runAbove = useCallback(
    (tabId: string, cellId: string) => runRange(tabId, cellId),
    [runRange]
  );

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    // Best-effort: tell the JS runner to stop the in-flight execute.
    // The worker treats `stop()` as a hard abort; the
    // `notebookSession.runNotebookCell` catches the `cancelled` flag
    // and resolves with `status: 'stopped'`.
    runnerManager.stop('javascript');
  }, []);

  return { isAnyCellRunning, runCell, runAll, runAbove, stop };
}
