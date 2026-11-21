import { useCallback, useEffect, useRef, useState } from 'react';
import { isLikelyComplete } from '../../../shared/autoRunGating';
import { AUTO_RUN_DEBOUNCE_MS } from '../../hooks/autoRunModel';
import { useEditorStore } from '../../stores/editorStore';
import { createDefaultTab } from '../../stores/editorTabUtils';
import { editorRunnerKey, notebookRunnerClaimEpoch, notebookRunnerOwner } from '../../stores/notebookRunnerLockStore';
import { useResultStore } from '../../stores/resultStore';
import { loadLastAnswer } from '../../stores/tabLastAnswer';
import type { Language } from '../../types/language';
import { promptAnswer, runsOnPause, type PromptAnswer } from './startPromptModel';

export type PromptRun =
  | { phase: 'idle' }
  | { phase: 'running'; code: string; previous?: PromptAnswer }
  | { phase: 'answered'; code: string; answer: PromptAnswer }
  /** A notebook cell or a manual run holds the shared runner. */
  | { phase: 'busy'; code: string };

let runnerManagerLoad: Promise<typeof import('../../runners/manager').runnerManager> | null = null;

// Dynamic so the runner graph stays out of the editor chunk Start ships in.
function loadRunnerManager() {
  runnerManagerLoad ??= import('../../runners/manager').then(
    module => module.runnerManager,
    (error: unknown) => {
      runnerManagerLoad = null;
      throw error;
    }
  );
  return runnerManagerLoad;
}

function lastAnswerOf(run: PromptRun): PromptAnswer | undefined {
  if (run.phase === 'answered') return run.answer;
  return run.phase === 'running' ? run.previous : undefined;
}

/**
 * Runs the Start prompt on the shared runner with its own result state, so the
 * editor's auto-run and the global result store never see it.
 */
export function useStartPromptRun(language: Language) {
  const [run, setRun] = useState<PromptRun>({ phase: 'idle' });
  const tokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  /** Drops the pending pause and any run in flight. */
  const invalidate = useCallback(() => {
    cancelPending();
    tokenRef.current += 1;
  }, [cancelPending]);

  useEffect(() => invalidate, [invalidate]);

  const execute = useCallback(
    async (code: string) => {
      cancelPending();
      const token = ++tokenRef.current;
      const key = editorRunnerKey(language, undefined);
      // Starting would terminate whatever holds the runner.
      if (notebookRunnerOwner(key) || useResultStore.getState().isManualRunning) {
        setRun({ phase: 'busy', code });
        return;
      }
      const epoch = notebookRunnerClaimEpoch(key);
      setRun(previous => ({ phase: 'running', code, previous: lastAnswerOf(previous) }));
      try {
        const [result, answers] = await Promise.all([
          loadRunnerManager().then(runnerManager => runnerManager.execute(language, code, { language, autoLog: true })),
          loadLastAnswer(),
        ]);
        if (token !== tokenRef.current) return;
        if (notebookRunnerClaimEpoch(key) !== epoch) {
          setRun({ phase: 'busy', code });
          return;
        }
        setRun({ phase: 'answered', code, answer: promptAnswer(answers, code, result, Date.now()) });
      } catch (error) {
        if (token !== tokenRef.current) return;
        const name = error instanceof Error ? error.name : 'Error';
        setRun({
          phase: 'answered',
          code,
          answer: { answer: { kind: 'code', status: 'error', numeral: '', label: name, ranAt: Date.now() } },
        });
      }
    },
    [cancelPending, language]
  );

  /** Every edit: JS and TS run once a complete line pauses; an incomplete one keeps the last answer. */
  const edit = useCallback(
    (code: string) => {
      if (!code.trim()) {
        invalidate();
        setRun({ phase: 'idle' });
        return;
      }
      cancelPending();
      if (!runsOnPause(language) || !isLikelyComplete(language, code).ready) return;
      timerRef.current = setTimeout(() => void execute(code), AUTO_RUN_DEBOUNCE_MS);
    },
    [cancelPending, execute, invalidate, language]
  );

  /** Enter: JS and TS keep the line as a scratch tab; other languages run first and keep on the next Enter. */
  const submit = useCallback(
    (code: string) => {
      if (!code.trim()) return;
      const answered = run.phase === 'answered' && run.code === code;
      if (!runsOnPause(language) && !answered) {
        void execute(code);
        return;
      }
      invalidate();
      useEditorStore.getState().addTab({ ...createDefaultTab(language), content: code });
    },
    [execute, invalidate, language, run]
  );

  return { run, shown: lastAnswerOf(run), edit, submit };
}
