import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import { runnerManager } from '../runners';
import type { ExecutionResult } from '../types';
import { toExecutionPresentation } from '../utils/executionPresentation';
import { toExecutionDiagnostics } from '../utils/executionDiagnostics';
import { executionModeForLanguage, languageCapabilityBadgeKey } from '../utils/languageMeta';
import { requiresNativeExecutionAcknowledgement } from '../utils/nativeExecution';
import { validateDocument } from '../validation';
import { currentEffectiveTier } from './useEntitlement';
import { isLanguageAllowed } from '../../shared/entitlements';
import { collectBrowserPreviewSiblingSources } from '../runtime/browserPreviewSiblings';
import { isLikelyComplete } from '../../shared/autoRunGating';
import { trackEvent } from '../utils/telemetry';

export const AUTO_RUN_DEBOUNCE_MS = 1200;
/**
 * Auto-run the active tab's code after a short pause in typing.
 * For dynamic languages: captures per-line results.
 * For compiled languages: captures full output.
 */
export function useAutoRun() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(false);
  const runTokenRef = useRef(0);
  const lastCodeRef = useRef('');

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTab = useEditorStore((s) => {
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  });

  const code = activeTab?.content ?? '';
  const language = activeTab?.language ?? 'javascript';
  // RL-019 Slice 3 — auto-run respects the per-tab runtime mode so
  // a tab set to Browser preview keeps using the iframe runner
  // during live updates, not the language Worker.
  const runtimeMode = activeTab?.runtimeMode;

  useEffect(() => {
    // Skip if no tab or empty code
    if (!activeTab || !code.trim()) {
      runTokenRef.current += 1;
      abortRef.current = true;
      useResultStore.getState().clear();
      return;
    }

    // Skip if code didn't change
    if (code === lastCodeRef.current) return;

    // Cancel any pending execution
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    abortRef.current = true;
    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;

    timerRef.current = setTimeout(async () => {
      const isRunStale = () =>
        abortRef.current ||
        runToken !== runTokenRef.current ||
        useResultStore.getState().isManualRunning;
      const shouldDiscardAutoResult = () =>
        isRunStale() || useResultStore.getState().executionSource !== 'auto';
      const finishAutoRunning = () => {
        if (runToken === runTokenRef.current && !abortRef.current) {
          useResultStore.getState().setIsAutoRunning(false);
        }
      };

      if (runToken !== runTokenRef.current || useResultStore.getState().isManualRunning) {
        return;
      }

      lastCodeRef.current = code;
      abortRef.current = false;

      const {
        clear,
        setLineResults,
        setFullOutput,
        setError,
        setDiagnostics,
        setExecutionTime,
        setExecutionSource,
        setIsAutoRunning,
        setAutoRunGateReason,
        captureSuccessfulSnapshot,
        restoreLastSuccessfulSnapshot,
      } = useResultStore.getState();
      const executionMode = executionModeForLanguage(language);
      const isWebBuild =
        typeof window !== 'undefined' && window.lingua?.platform === 'web';
      const proLanguageGate =
        executionMode === 'run' &&
        !isLanguageAllowed(currentEffectiveTier(), language);
      const desktopOnlyGate =
        isWebBuild &&
        executionMode === 'run' &&
        languageCapabilityBadgeKey(language) === 'language.capability.desktopOnly';

      if (executionMode === 'view') {
        clear();
        return;
      }

      if (desktopOnlyGate || proLanguageGate) {
        clear();
        return;
      }

      // RL-079 — silently bail when Go/Rust haven't been acknowledged
      // yet. Auto-run runs on every keystroke; surfacing the trust
      // modal here would surprise the user with a dialog they didn't
      // ask for. The first manual Run shows the modal; once they
      // acknowledge, auto-run takes over for subsequent edits.
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
          if (shouldDiscardAutoResult()) {
            finishAutoRunning();
            return;
          }

          setLineResults([]);
          setFullOutput(validation.fullOutput);
          setError(null);
          setDiagnostics(validation.diagnostics);
          setExecutionTime(validation.executionTime);
        } catch (err) {
          if (!shouldDiscardAutoResult()) {
            setError({
              message: err instanceof Error ? err.message : String(err),
            });
            setDiagnostics([]);
          }
        } finally {
          finishAutoRunning();
        }
        return;
      }

      // Check if language is supported
      if (!runnerManager.isSupported(language)) {
        clear();
        return;
      }

      // RL-020 Slice 1 — auto-run completion gate. Skip the runner
      // entirely when the buffer is in an obviously mid-edit state
      // (open bracket, trailing operator, trailing keyword, ...) so
      // the console / iframe stop flickering between SyntaxErrors
      // while the user is still typing. Only the runner branch is
      // gated — `validate` and `view` already returned above. JS / TS
      // are the only languages flagged this slice; everything else
      // gets `ready: true` and falls through unchanged.
      const gate = isLikelyComplete(language, code);
      if (!gate.ready && gate.reason === 'incomplete') {
        // Preserve the last good output instead of clearing the
        // panel — gives the user a stable reference while they
        // finish the expression.
        const restored = restoreLastSuccessfulSnapshot();
        if (!restored) {
          // Nothing to restore (first run on this tab): leave any
          // existing state intact but make sure the error / spinner
          // surfaces from a previous attempt don't linger.
          setError(null);
          setDiagnostics([]);
        }
        setAutoRunGateReason('incomplete');
        setIsAutoRunning(false);
        // Fold A — telemetry. Single emit per debounced run; the
        // consent gate is already enforced upstream by `trackEvent`.
        void trackEvent('runtime.auto_run_gated', {
          language,
          reason: 'incomplete',
        });
        return;
      }
      // Gate cleared. Stash the `ok` reason AFTER `clear()` so the
      // store-level reset of `autoRunGateReason` (intentional on tab
      // switch) does not nuke the reason we just set for this run.
      setIsAutoRunning(true);
      clear();
      setExecutionSource('auto');
      setAutoRunGateReason(gate.reason);

      try {
        // RL-019 Slice 3 fold A — auto-run mirrors the manual path so
        // sibling .css / .html tabs seed the iframe srcdoc on every
        // keystroke. Without this, only the first manual Run sees the
        // companions; auto-rerunning the JS tab would silently strip
        // them. Kept inside the try so a sibling lookup throw cannot
        // poison the run — fall back to plain execution.
        if (runtimeMode === 'browser-preview') {
          try {
            const editorState = useEditorStore.getState();
            const siblingSources = collectBrowserPreviewSiblingSources(editorState.tabs, activeTab);
            runnerManager.getBrowserPreviewRunner()?.setSiblingSources(siblingSources);
          } catch {
            /* sibling lookup is best-effort; ignore */
          }
        }

        const { runner } = await runnerManager.prepareRunner(language, runtimeMode);
        if (!runner || shouldDiscardAutoResult()) {
          finishAutoRunning();
          return;
        }

        const result: ExecutionResult = await runner.execute(code);

        // If another execution was triggered while we were running, discard.
        // This includes completed manual flows: once the panel's source is no
        // longer this auto-run, the stale auto result must not write into it.
        if (shouldDiscardAutoResult()) {
          finishAutoRunning();
          return;
        }

        const presentation = toExecutionPresentation(language, code, result);
        setLineResults(presentation.lineResults);
        setFullOutput(presentation.fullOutput);
        setDiagnostics(toExecutionDiagnostics(language, result.error ?? null));

        setExecutionTime(result.executionTime);
        if (result.error) {
          setError(result.error);
        } else {
          setError(null);
          // RL-020 Slice 1 — capture the panel as the last good run
          // so a future gated keystroke can restore it. Skip when
          // the runner reported an error — that buffer isn't a
          // restoration target.
          captureSuccessfulSnapshot();
        }
      } catch (err) {
        if (!shouldDiscardAutoResult()) {
          setError({
            message: err instanceof Error ? err.message : String(err),
          });
          setDiagnostics([]);
        }
      } finally {
        finishAutoRunning();
      }
    }, AUTO_RUN_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [code, language, runtimeMode, activeTab, activeTabId]);

  // Clear results when switching tabs
  useEffect(() => {
    lastCodeRef.current = '';
    useResultStore.getState().clear();
  }, [activeTabId]);
}
