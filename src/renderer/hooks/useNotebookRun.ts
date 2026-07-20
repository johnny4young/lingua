/**
 * implementation — `useNotebookRun` hook.
 *
 * Per-tab orchestration for Run cell / Run all / Run above / Stop.
 * Bypasses `useRunner` so notebook execution does NOT pollute the
 * user's regular execution history or capsule snapshots (mirror of
 * the implementation `useRecipeRun` pattern).
 *
 * Concurrency: implementation blocks `'concurrent-run'` per tab. The
 * `runAll` / `runAbove` loops invoke `runNotebookCell` sequentially
 * with an early-stop when a cell errors (mirrors Jupyter's default
 * "stop on first failure" behavior).
 *
 * Stop semantics: clicking `Stop` flips `stopRequested = true` and
 * also calls `runnerManager.stop('javascript')` so the worker's
 * Promise rejects. The current cell's status becomes `'stopped'`;
 * subsequent cells in a `runAll` chain do not run.
 *
 * FASE 4: this hook also owns the per-cell latency (measured around
 * the `runNotebookCell` await) and the inter-cell variable flow
 * (`produces` from the kernel delta, `uses` from a pre-run sandbox
 * snapshot ∩ source token scan). Both land in TRANSIENT store maps —
 * `notebookSession` stays timing-free.
 */

import { useCallback, useRef, useState } from 'react';
import {
  isNotebookCodeCell,
  type NotebookCellLanguage,
  type NotebookCellOutputV1,
  type NotebookV1,
} from '../../shared/notebook';
import {
  getNotebookSessionKeys,
  isNotebookRunnableLanguage,
  runNotebookCell,
  type NotebookCellRunOutcome,
} from '../runtime/notebookSession';
import i18next from 'i18next';
import { runnerManager } from '../runners';
import { useNotebookStore } from '../stores/notebookStore';
import { useUIStore } from '../stores/uiStore';
import { useAnnounce } from './useAnnounce';
import { trackNotebookCellExecuted } from './notebookTelemetry';

/**
 * FASE 4 — cheap `uses` derivation. We scan the cell source for
 * JS identifier tokens and keep only those that already existed in
 * the per-tab sandbox BEFORE the run. This is intentionally a regex
 * token match, not static analysis: it over-reports an identifier
 * that only appears inside a string/comment, and under-reports
 * member access like `obj.foo` (we match `obj`, not `foo`). That is
 * an acceptable implementation approximation for a header hint — the
 * authoritative cross-cell wiring still lives in the kernel's
 * pull-in step. Bounded to the first matches to keep the chip short.
 */
const IDENTIFIER_TOKEN_RE = /[A-Za-z_$][\w$]*/g;
const MAX_USES_CHIP_KEYS = 8;

function deriveUsesKeys(
  source: string,
  priorSandboxKeys: ReadonlyArray<string>
): string[] {
  if (priorSandboxKeys.length === 0 || source.length === 0) return [];
  const priorSet = new Set(priorSandboxKeys);
  const referenced = new Set<string>();
  for (const match of source.matchAll(IDENTIFIER_TOKEN_RE)) {
    const token = match[0];
    if (priorSet.has(token)) referenced.add(token);
    if (referenced.size >= MAX_USES_CHIP_KEYS) break;
  }
  return [...referenced];
}

export interface UseNotebookRunResult {
  /** True while any cell is in flight for this tab. */
  readonly isAnyCellRunning: boolean;
  /** Run a single cell by id. */
  runCell: (tabId: string, cellId: string) => Promise<void>;
  /** Run every code cell in order. Stops at first error. */
  runAll: (tabId: string) => Promise<void>;
  /** Run every cell from the top THROUGH the given cell id (inclusive). */
  runAbove: (tabId: string, cellId: string) => Promise<void>;
  /** Run the given cell + every code cell BELOW it (inclusive). Stops
   * at the first error, mirroring `runAll` / `runAbove`. */
  runFromHere: (tabId: string, cellId: string) => Promise<void>;
  /** Signal the in-flight cell + the loop to abort. */
  stop: () => void;
}

export function useNotebookRun(): UseNotebookRunResult {
  const [isAnyCellRunning, setIsAnyCellRunning] = useState(false);
  const stopRequestedRef = useRef(false);
  const announce = useAnnounce();

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

      // implementation Slice F (implementation note) — the first Python cell run boots Pyodide
      // (web) / the native runtime, which can take a few seconds. Surface
      // a one-shot info notice so a freshly-clicked Python cell doesn't
      // read as hung. `needsInitialization` is false on every subsequent
      // run, so the notice only fires on the cold start.
      if (
        cell.language === 'python' &&
        runnerManager.needsInitialization('python')
      ) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'notebook.notice.pythonStarting',
        });
      }

      // FASE 4 — snapshot the sandbox keys BEFORE the run so the
      // `uses` chip reflects what this cell consumed from earlier
      // cells (the run itself will add this cell's own declarations).
      const priorSandboxKeys = getNotebookSessionKeys(tabId);
      const startedAt = performance.now();

      try {
        const result = await runNotebookCell({
          tabId,
          language: cell.language,
          source: cell.source,
        });
        // FASE 4 — measure only the kernel round-trip; timing lives in
        // the hook, never in `notebookSession`, to keep the kernel file
        // minimal (GAP A).
        const durationMs = performance.now() - startedAt;

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
        // Signal-Slate — stamp the Jupyter `[N]` execution number on
        // every settled run (ok / error / stopped). A `stopped` run
        // still consumed a slot in the kernel, so it earns a number
        // too, matching Jupyter's interrupted-cell behavior.
        store.setCellExecutionOrder(tabId, cellId);
        // FASE 4 — thread the transient latency + variable-flow into
        // the store. `produces` comes straight from the kernel's
        // delta keys; `uses` is the cheap pre-run snapshot ∩ token
        // scan. Recorded for every terminal outcome (ok / error /
        // stopped) so a failed cell still shows how long it ran.
        store.setCellDurationMs(tabId, cellId, durationMs);
        store.setCellVarFlow(tabId, cellId, {
          uses: deriveUsesKeys(cell.source, priorSandboxKeys),
          produces: outcome.producedKeys,
        });
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
        // Signal-Slate — an errored run still earns a `[N]` stamp.
        store.setCellExecutionOrder(tabId, cellId);
        // FASE 4 — even an unexpected throw gets its latency + a
        // (produces-empty) var-flow entry so the header stays coherent.
        store.setCellDurationMs(tabId, cellId, performance.now() - startedAt);
        store.setCellVarFlow(tabId, cellId, {
          uses: deriveUsesKeys(cell.source, priorSandboxKeys),
          produces: [],
        });
        trackNotebookCellExecuted({
          language: cell.language,
          status: 'error',
        });
        return {
          status: 'error',
          stdout: [],
          stderr: [message],
          sandboxKeyCount: 0,
          producedKeys: [],
        };
      } finally {
        setIsAnyCellRunning(false);
      }
    },
    []
  );

  const runCell = useCallback(
    async (tabId: string, cellId: string): Promise<void> => {
      stopRequestedRef.current = false;
      const outcome = await runCellInternal(tabId, cellId);
      // accessibility pass — announce the cell-run result to screen readers; the
      // `[N]` stamp + output region only convey it visually. Resolve the
      // copy off the global i18next instance so the hook stays render-light.
      if (outcome) {
        announce(
          outcome.status === 'ok'
            ? i18next.t('notebook.cell.announce.ok')
            : outcome.status === 'stopped'
              ? i18next.t('notebook.cell.announce.stopped')
              : i18next.t('notebook.cell.announce.error')
        );
      }
    },
    [runCellInternal, announce]
  );

  /**
   * Run a contiguous slice of cells `[startIdx, stopIdx]` (both
   * inclusive, ascending) in order, stopping at the first error /
   * stopped / rejected outcome. Backs `runAll` (whole notebook),
   * `runAbove` (top → cell), and `runFromHere` (cell → bottom). The
   * three public entry points pin `startCellId` / `throughCellId` to
   * carve out their range; the unsupported-language notice fires only
   * when EVERY code cell in the range was skipped.
   */
  const runRange = useCallback(
    async (
      tabId: string,
      startCellId: string | null,
      throughCellId: string | null
    ): Promise<void> => {
      stopRequestedRef.current = false;
      const notebook: NotebookV1 | undefined = useNotebookStore
        .getState()
        .getNotebookForTab(tabId);
      if (!notebook) return;
      const startIdx =
        startCellId === null
          ? 0
          : notebook.cells.findIndex((c) => c.id === startCellId);
      const stopIdx =
        throughCellId === null
          ? notebook.cells.length - 1
          : notebook.cells.findIndex((c) => c.id === throughCellId);
      if (startIdx === -1 || stopIdx === -1) return;
      let ranRunnableCell = false;
      let skippedUnsupportedCodeCell = false;
      let runCount = 0;
      let terminalStatus: NotebookCellRunOutcome['status'] | null = null;
      setIsAnyCellRunning(true);
      try {
        for (let i = startIdx; i <= stopIdx; i += 1) {
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
          runCount += 1;
          terminalStatus = outcome.status;
          if (outcome.status === 'error' || outcome.status === 'stopped') break;
        }
        if (!ranRunnableCell && skippedUnsupportedCodeCell) {
          useUIStore.getState().pushStatusNotice({
            tone: 'info',
            messageKey: 'notebook.notice.languageNotSupported',
          });
        }
        if (runCount > 0 && terminalStatus) {
          announce(
            terminalStatus === 'ok'
              ? i18next.t('notebook.range.announce.ok', { count: runCount })
              : terminalStatus === 'stopped'
                ? i18next.t('notebook.range.announce.stopped', { count: runCount })
                : i18next.t('notebook.range.announce.error', { count: runCount })
          );
        }
      } finally {
        setIsAnyCellRunning(false);
      }
    },
    [runCellInternal, announce]
  );

  const runAll = useCallback(
    (tabId: string) => runRange(tabId, null, null),
    [runRange]
  );
  const runAbove = useCallback(
    (tabId: string, cellId: string) => runRange(tabId, null, cellId),
    [runRange]
  );
  const runFromHere = useCallback(
    (tabId: string, cellId: string) => runRange(tabId, cellId, null),
    [runRange]
  );

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    // Best-effort: tell the in-flight runner to abort. We stop both
    // notebook-runnable runners because the hook does not track which
    // language is currently executing — JS / TS share the `'javascript'`
    // worker (TS type-strips to JS), Python  runs on the
    // `'python'` runner. `stop()` is idempotent on an idle runner, so
    // stopping both is safe. The worker / native runtime treats this as a
    // hard abort; `notebookSession.runNotebookCell` catches the
    // `cancelled` flag and resolves with `status: 'stopped'`.
    runnerManager.stop('javascript');
    runnerManager.stop('python');
  }, []);

  return { isAnyCellRunning, runCell, runAll, runAbove, runFromHere, stop };
}
