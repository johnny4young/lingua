import { useConsoleStore } from '../stores/consoleStore';
import { useResultStore } from '../stores/resultStore';
import type { ExecutionResult, Language } from '../types';
import { toExecutionDiagnostics } from '../utils/executionDiagnostics';
import { toExecutionPresentation } from '../utils/executionPresentation';
import { trackEvent } from '../utils/telemetry';
import { isWorkerRunnerLanguage } from '../../shared/languageFamilies';
import { bucketAutoLogCount } from './autoRunModel';
import { toConsoleEntries } from './runnerOutput';

interface ApplyAutoRunResultOptions {
  code: string;
  language: Language;
  result: ExecutionResult;
}

/** Publish a non-stale runner result to the inline and console surfaces. */
export function applyAutoRunResult({
  code,
  language,
  result,
}: ApplyAutoRunResultOptions): void {
  const {
    setLineResults,
    setFullOutput,
    setError,
    setDiagnostics,
    setExecutionTime,
    setStdinConsumed,
    captureSuccessfulSnapshot,
    setScopeSnapshot,
  } = useResultStore.getState();
  const presentation = toExecutionPresentation(language, code, result);

  // Preserve watch and auto-log rows from the last clean snapshot when an
  // unrelated line errors, avoiding a transient empty inline result.
  let nextLineResults = presentation.lineResults;
  if (result.error) {
    const previousSnapshot = useResultStore.getState().lastSuccessfulSnapshot;
    if (previousSnapshot) {
      const stickyKinds: ReadonlySet<string> = new Set(['watch', 'autoLog']);
      const freshStickyLines = new Set(
        nextLineResults
          .filter((entry) => stickyKinds.has(entry.type))
          .map((entry) => `${entry.type}:${entry.line}`)
      );
      const persistedSticky = previousSnapshot.lineResults.filter(
        (entry) =>
          stickyKinds.has(entry.type) &&
          !freshStickyLines.has(`${entry.type}:${entry.line}`)
      );
      if (persistedSticky.length > 0) {
        nextLineResults = [...nextLineResults, ...persistedSticky];
      }
    }
  }

  setLineResults(nextLineResults);
  setFullOutput(presentation.fullOutput);

  // The bottom console owns rich payload rendering, so mirror the manual run
  // path instead of publishing only the inline full-output projection.
  const consoleStore = useConsoleStore.getState();
  consoleStore.clear();
  for (const entry of toConsoleEntries(result, language)) {
    consoleStore.addEntry(entry);
  }

  setStdinConsumed(result.stdinConsumed ?? null);
  setDiagnostics(toExecutionDiagnostics(language, result.error ?? null));
  setExecutionTime(result.executionTime);

  if (result.error) {
    setError(result.error);
    return;
  }

  setError(null);
  captureSuccessfulSnapshot(language);
  setScopeSnapshot(result.scopeSnapshot ?? null);
  trackAutoRunAdoption(language, result);
}

function trackAutoRunAdoption(
  language: Language,
  result: ExecutionResult
): void {
  if (result.magicResults && result.magicResults.length > 0) {
    const hasArrow = result.magicResults.some(
      (entry) => entry.kind === 'arrow'
    );
    const hasWatch = result.magicResults.some(
      (entry) => entry.kind === 'watch'
    );
    void trackEvent('runtime.magic_comment_emitted', {
      language,
      hasArrow,
      hasWatch,
    });

    const autoLogCount = result.magicResults.filter(
      (entry) => entry.kind === 'autoLog'
    ).length;
    if (autoLogCount > 0) {
      void trackEvent('runtime.auto_log_emitted', {
        language,
        countBucket: bucketAutoLogCount(autoLogCount),
      });
    }
  }

  if (
    result.stdinConsumed &&
    result.stdinConsumed.count > 0 &&
    isWorkerRunnerLanguage(language)
  ) {
    void trackEvent('runtime.stdin_used', { language });
  }
}
