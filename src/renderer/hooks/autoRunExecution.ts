import { executionKind } from '../utils/executionOutcome';
import { webExecutionBoundary } from '../utils/runtimeModeSupport';
import { isLanguageAllowed } from '../../shared/entitlements';
import { isLikelyComplete } from '../../shared/autoRunGating';
import { isWorkerRunnerLanguage } from '../../shared/languageFamilies';
import { defaultRuntimeTimeoutPreset, presetToMs } from '../../shared/runtimeTimeoutPresets';
import { runnerManager } from '../runners';
import { useEditorStore } from '../stores/editorStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { FileTab } from '../types/editor';
import { executionModeForLanguage } from '../utils/languageMeta';
import { extractTimeoutMagicComment } from '../utils/magicComments';
import { requiresNativeExecutionAcknowledgement } from '../utils/nativeExecution';
import { trackEvent } from '../utils/telemetry';
import { validateDocument } from '../validation';
import type { AutoRunInput } from './autoRunModel';
import { applyAutoRunResult } from './autoRunResult';
import { currentEffectiveTier } from './useEntitlement';
import { trackBrowserPreviewAutoRefreshOnce } from './browserPreviewRefreshTelemetry';
import type { TelemetryTrack } from './useTelemetry';

interface ExecuteAutoRunOptions {
  input: AutoRunInput;
  activeTab: FileTab;
  activeTabId: string | null;
  shouldDiscard: () => boolean;
  finish: () => void;
  track: TelemetryTrack;
}

/** Execute one accepted auto-run input and publish it only while still current. */
export async function executeAutoRun({
  input,
  activeTab,
  activeTabId,
  shouldDiscard,
  finish,
  track,
}: ExecuteAutoRunOptions): Promise<void> {
  const {
    clear,
    clearVisibleResults,
    setLineResults,
    setFullOutput,
    setError,
    setDiagnostics,
    setExecutionTime,
    setExecutionSource,
    setIsAutoRunning,
    setAutoRunGateReason,
    setRunTermination,
    setRunDeadlineAt,
    restoreLastSuccessfulSnapshot,
  } = useResultStore.getState();
  const {
    code,
    language,
    runtimeMode,
    autoLogEnabled,
    browserPreviewRefreshIntervalMs,
    stdinBuffer,
  } = input;
  const executionMode = executionModeForLanguage(language);
  const isWebBuild =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';
  const proLanguageGate =
    executionMode === 'run' &&
    !isLanguageAllowed(currentEffectiveTier(), language);
  const desktopOnlyGate =
    executionMode === 'run' && webExecutionBoundary(language, runtimeMode, isWebBuild) !== null;

  if (executionMode === 'view' || desktopOnlyGate || proLanguageGate) {
    clear();
    return;
  }

  // Native trust acknowledgement is a manual gesture; auto-run stays silent.
  if (
    executionMode === 'run' &&
    requiresNativeExecutionAcknowledgement(language) &&
    !useSettingsStore.getState().nativeExecutionAcknowledged
  ) {
    clear();
    return;
  }

  if (executionMode === 'validate') {
    setIsAutoRunning(true);
    clear();
    setExecutionSource('auto');
    try {
      const validation = validateDocument(language, code);
      if (shouldDiscard()) {
        finish();
        return;
      }
      setLineResults([]);
      setFullOutput(validation.fullOutput);
      setError(null);
      setDiagnostics(validation.diagnostics);
      setExecutionTime(validation.executionTime);
    } catch (error) {
      if (!shouldDiscard()) {
        setError({
          message: error instanceof Error ? error.message : String(error),
        });
        setDiagnostics([]);
      }
    } finally {
      finish();
    }
    return;
  }

  if (!runnerManager.isSupported(language)) {
    clear();
    return;
  }

  const gate = isLikelyComplete(language, code);
  if (!gate.ready && gate.reason === 'incomplete') {
    const restored = restoreLastSuccessfulSnapshot();
    if (!restored) {
      setError(null);
      setDiagnostics([]);
    }
    setAutoRunGateReason('incomplete');
    setIsAutoRunning(false);
    void trackEvent('runtime.auto_run_gated', {
      language,
      reason: 'incomplete',
    });
    return;
  }

  setIsAutoRunning(true);
  clearVisibleResults();
  setExecutionSource('auto');
  setAutoRunGateReason(gate.reason);

  try {
    const { runner } = await runnerManager.prepareRunner(language, runtimeMode);
    if (!runner || shouldDiscard()) {
      finish();
      return;
    }

    const magicTimeoutMs = extractTimeoutMagicComment(language, code);
    const oneShotOverrideMs =
      typeof activeTab.nextRunTimeoutOverrideMs === 'number'
        ? activeTab.nextRunTimeoutOverrideMs
        : null;
    const overrideMs = oneShotOverrideMs ?? magicTimeoutMs ?? null;
    const settings = useSettingsStore.getState();
    const timeoutPreset =
      settings.runtimeTimeoutPresetByLanguage?.[language] ??
      defaultRuntimeTimeoutPreset(language);
    setRunDeadlineAt(Date.now() + (overrideMs ?? presetToMs(timeoutPreset)));

    if (oneShotOverrideMs !== null && activeTabId) {
      useEditorStore
        .getState()
        .setTabNextRunTimeoutOverride(activeTabId, null);
    }

    const capturesScope = isWorkerRunnerLanguage(language);
    const scopeDepth = settings.variableInspectorScopeDepth;
    if (
      runtimeMode === 'browser-preview' &&
      browserPreviewRefreshIntervalMs !== null &&
      browserPreviewRefreshIntervalMs !== 0
    ) {
      trackBrowserPreviewAutoRefreshOnce(
        track,
        language,
        browserPreviewRefreshIntervalMs
      );
    }
    const result = await runner.execute(code, {
      language,
      ...(activeTab.filePath ? { filePath: activeTab.filePath } : {}),
      tabId: activeTab.id,
      autoLog: autoLogEnabled,
      // internal — Settings-level per-line timing; the runner also honors
      // an in-buffer // @time directive on its own.
      ...(useSettingsStore.getState().showLineTiming ? { lineTiming: true } : {}),
      ...(stdinBuffer !== undefined ? { stdin: stdinBuffer } : {}),
      ...(activeTab.inputArgs && activeTab.inputArgs.length > 0
        ? { args: activeTab.inputArgs }
        : {}),
      ...(overrideMs !== null ? { timeout: overrideMs } : {}),
      ...(runtimeMode === 'browser-preview'
        ? { preserveBrowserPreviewOnFailure: true }
        : {}),
      ...(capturesScope ? { captureScope: true } : {}),
      ...(capturesScope && typeof scopeDepth === 'number'
        ? { scopeDepth }
        : {}),
    });

    // These two fields historically settle before the stale-result guard;
    // preserve that ordering while the visible result remains protected.
    setRunDeadlineAt(null);
    setRunTermination({
      kind: executionKind(result),
      timeoutPreset: result.timeoutPreset,
      timeoutMs: result.timeoutMs,
    });

    if (shouldDiscard()) {
      finish();
      return;
    }
    applyAutoRunResult({
      autoLogEnabled,
      code,
      language,
      result,
    });
  } catch (error) {
    if (!shouldDiscard()) {
      setError({
        message: error instanceof Error ? error.message : String(error),
      });
      setDiagnostics([]);
    }
  } finally {
    finish();
  }
}
