import { useConsoleStore } from '../stores/consoleStore';
import { useResultStore } from '../stores/resultStore';
import type { Language } from '../types';
import type { ExecutionResult } from '../types/execution';
import { toExecutionDiagnostics } from '../utils/executionDiagnostics';
import { toExecutionPresentation } from '../utils/executionPresentation';
import { trackEvent } from '../utils/telemetry';
import { isWorkerRunnerLanguage } from '../../shared/languageFamilies';
import { bucketAutoLogCount } from './autoRunModel';
import { preserveStickyLineResults } from './autoRunStickyResults';
import { toConsoleEntries } from './runnerOutput';

interface ApplyAutoRunResultOptions {
  autoLogEnabled?: boolean;
  code: string;
  language: Language;
  result: ExecutionResult;
}

/** Publish a non-stale runner result to the inline and console surfaces. */
export function applyAutoRunResult({
  autoLogEnabled = false,
  code,
  language,
  result,
}: ApplyAutoRunResultOptions): void {
  const {
    setLineResults,
    setLineTimings,
    setFullOutput,
    setError,
    setDiagnostics,
    setExecutionTime,
    setStdinConsumed,
    captureSuccessfulSnapshot,
    setScopeSnapshot,
  } = useResultStore.getState();
  const presentation = toExecutionPresentation(language, code, result);

  // Preserve watch and auto-log rows only when their exact source line still
  // exists and the failure happened elsewhere. Type + line alone is not a
  // safe identity after an edit because it can resurrect an obsolete value.
  const nextLineResults = result.error
    ? preserveStickyLineResults({
        autoLogEnabled,
        code,
        error: result.error,
        language,
        lineResults: presentation.lineResults,
        previousSnapshot: useResultStore.getState().lastSuccessfulSnapshot,
      })
    : presentation.lineResults;

  setLineResults(nextLineResults);
  // internal — publish per-statement timings alongside the line results.
  setLineTimings(result.lineTimings ?? []);
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
  captureSuccessfulSnapshot(language, code);
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
