import { useEffect, useRef } from 'react';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
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
import {
  defaultRuntimeTimeoutPreset,
  presetToMs,
} from '../../shared/runtimeTimeoutPresets';
import { defaultWorkflowMode } from '../../shared/workflowMode';
import { trackEvent } from '../utils/telemetry';
import { extractTimeoutMagicComment } from '../utils/magicComments';
import { useConsoleStore } from '../stores/consoleStore';
import { toConsoleEntries } from './runnerOutput';
import type { Language } from '../types';

export const AUTO_RUN_DEBOUNCE_MS = 1200;
export type AutoLogCountBucket = '1' | '2-5' | '6-20' | '20-plus';

interface LastAutoRunInput {
  code: string;
  language: string;
  runtimeMode: string | undefined;
  workflowMode: string;
  autoLogEnabled: boolean;
  /**
   * RL-020 Slice 6 — the pre-set stdin buffer is part of the run's
   * effective input. Editing the panel without touching the code
   * must still re-run; including the buffer in the dedup key keeps
   * the auto-run honest about which inputs changed.
   */
  stdinBuffer: string | undefined;
}

/**
 * RL-020 Slice 5 fold A — bucket an auto-log emission count into a
 * closed-enum string so the redactor accepts the payload through the
 * existing safe-token allowlist. Buckets mirror the orders of
 * magnitude a user is most likely to hit: a one-off exploration
 * (`1`), a small scratchpad (`2-5`), a longer session (`6-20`), and
 * an outlier 50-line block (`20-plus`). The renderer + worker
 * telemetry validators lock the closed set; a future expansion
 * amends both copies in the same commit (the parity test enforces
 * it at CI time).
 */
export function bucketAutoLogCount(count: number): AutoLogCountBucket {
  if (count <= 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  return '20-plus';
}
/**
 * Auto-run the active tab's code after a short pause in typing.
 * For dynamic languages: captures per-line results.
 * For compiled languages: captures full output.
 */
export function useAutoRun() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(false);
  const runTokenRef = useRef(0);
  const lastRunInputRef = useRef<LastAutoRunInput | null>(null);

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTab = useEditorStore((s) => getActiveTab(s));

  const code = activeTab?.content ?? '';
  const language = activeTab?.language ?? 'javascript';
  // RL-019 Slice 3 — auto-run respects the per-tab runtime mode so
  // a tab set to Browser preview keeps using the iframe runner
  // during live updates, not the language Worker.
  const runtimeMode = activeTab?.runtimeMode;
  // RL-020 Slice 2 — auto-run only fires when the active tab is in
  // Scratchpad workflow mode. Run + Debug modes are manual-gesture
  // workflows where the user does NOT want background reruns. The
  // resolved selector falls through to `defaultWorkflowMode` for
  // tabs missing the field (pre-Slice-2 persisted state).
  const workflowMode =
    activeTab?.workflowMode ?? defaultWorkflowMode(language);
  // RL-020 Slice 5 — auto-log gate resolution. Per-tab override
  // (fold C) wins over the per-language Settings default; the
  // resolved value flows into the runner via `ExecutionContext.autoLog`.
  // Only JS / TS Scratchpad-mode tabs are eligible; everything else
  // resolves to `false` so the runner never runs the auto-log
  // transform on non-Scratchpad runs (manual paths route through
  // `executeTabManually` which deliberately omits the flag).
  const autoLogByLanguage = useSettingsStore(
    (s) => s.scratchpadAutoLogByLanguage
  );
  const autoLogEnabled =
    (language === 'javascript' || language === 'typescript') &&
    workflowMode === 'scratchpad' &&
    (activeTab?.autoLogEnabled === undefined
      ? autoLogByLanguage[language] === true
      : activeTab.autoLogEnabled === true);
  // RL-020 Slice 6 — pre-set stdin buffer threaded into the runner.
  // The buffer survives auto-run cycles; the worker re-reads it
  // from scratch on every invocation (no cross-run consumption
  // state).
  const stdinBuffer = activeTab?.stdinBuffer;

  useEffect(() => {
    // RL-020 Slice 2 — workflow-mode short-circuit FIRST. When the
    // user is in Run or Debug mode this hook is a TRUE no-op: we do
    // not touch `isAutoRunning`, do not advance `lastCodeRef`, do
    // not call `clear()`. Even the empty-code branch below stays
    // dormant — the user's last manual run stays on screen
    // indefinitely. Manual Run gestures and the Debug drawer
    // produce output through their own paths.
    if (workflowMode !== 'scratchpad') {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current = true;
      runTokenRef.current += 1;
      lastRunInputRef.current = null;

      const resultState = useResultStore.getState();
      if (resultState.isAutoRunning) {
        resultState.setIsAutoRunning(false);
      }
      if (resultState.autoRunGateReason !== null) {
        resultState.setAutoRunGateReason(null);
      }
      if (resultState.executionSource === 'auto') {
        resultState.setExecutionSource(null);
      }
      return;
    }

    // Skip if no tab or empty code
    if (!activeTab || !code.trim()) {
      runTokenRef.current += 1;
      abortRef.current = true;
      lastRunInputRef.current = null;
      useResultStore.getState().setIsAutoRunning(false);
      // RL-020 Slice 3 — preserve `lastSuccessfulSnapshot` through
      // an empty-buffer transit (Cmd+A → Backspace → type) so the
      // Slice 1 gate's restore path still has something to fall
      // back to once the user retypes. The full `clear()` still
      // fires on tab switch via the second useEffect below.
      useResultStore.getState().clearVisibleResults();
      return;
    }

    // Skip if the effective auto-run input did not change. This is
    // intentionally broader than code: toggling auto-log, changing
    // runtime mode, or returning to Scratchpad must re-run the same
    // buffer because the execution surface changed.
    const lastRunInput = lastRunInputRef.current;
    if (
      lastRunInput &&
      lastRunInput.code === code &&
      lastRunInput.language === language &&
      lastRunInput.runtimeMode === runtimeMode &&
      lastRunInput.workflowMode === workflowMode &&
      lastRunInput.autoLogEnabled === autoLogEnabled &&
      lastRunInput.stdinBuffer === stdinBuffer
    ) {
      return;
    }

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

      lastRunInputRef.current = {
        code,
        language,
        runtimeMode,
        workflowMode,
        autoLogEnabled,
        stdinBuffer,
      };
      abortRef.current = false;

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
        setStdinConsumed,
        setRunTermination,
        setRunDeadlineAt,
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
      clearVisibleResults();
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

        // RL-020 Slice 5 — only JS / TS auto-run paths thread the
        // auto-log flag. Other runners ignore the field, but the
        // resolved gate already restricts `autoLogEnabled` to
        // JS / TS so the payload is symmetric.
        // RL-020 Slice 6 — the stdin buffer rides on the same
        // context. Runners that don't consume it ignore it.
        // RL-020 Slice 7 fold B — honor the magic-comment timeout
        // on auto-run too (the directive is part of the buffer, so
        // the user's expectation is that it applies whenever the
        // buffer runs). Fold D — auto-run also consumes the per-tab
        // one-shot override armed via the "Run with extended
        // timeout" palette command, so the override fires on the
        // very next auto-run if the user happens to be typing on a
        // Scratchpad-mode tab.
        const magicTimeoutMs = extractTimeoutMagicComment(language, code);
        const oneShotOverrideMs =
          typeof activeTab?.nextRunTimeoutOverrideMs === 'number'
            ? activeTab.nextRunTimeoutOverrideMs
            : null;
        const overrideMs =
          oneShotOverrideMs ?? magicTimeoutMs ?? null;
        // RL-020 Slice 7 fold E — set the in-flight deadline before
        // execute() resolves so the countdown pill can render.
        // Resolution mirrors the runner: explicit override wins;
        // otherwise read the per-language Settings preset, falling
        // back to the language default when the map key is missing
        // (a fresh install before rehydration completes, or a
        // tampered persisted state).
        const settingsForDeadline = useSettingsStore.getState();
        const presetForDeadline =
          settingsForDeadline.runtimeTimeoutPresetByLanguage?.[language] ??
          defaultRuntimeTimeoutPreset(language);
        const armedDeadlineMs =
          overrideMs ?? presetToMs(presetForDeadline);
        setRunDeadlineAt(Date.now() + armedDeadlineMs);

        // Consume the one-shot override the moment we pass it onto
        // the runner — symmetric to the manual run path.
        if (oneShotOverrideMs !== null && activeTabId) {
          useEditorStore
            .getState()
            .setTabNextRunTimeoutOverride(activeTabId, null);
        }

        // RL-020 Slice 9 — capture the post-execute scope eagerly
        // on auto-run for inspector-supported languages so the
        // toggle lights up after the first clean run without the
        // user needing to opt in first. Renders / serialization
        // happens lazily in the panel.
        const variableInspectorLanguages = new Set<string>([
          'javascript',
          'typescript',
          'python',
        ]);
        const wantsScopeCapture = variableInspectorLanguages.has(language);
        const scopeDepthPref = useSettingsStore.getState().variableInspectorScopeDepth;
        const result: ExecutionResult = await runner.execute(code, {
          language,
          ...(activeTab?.filePath ? { filePath: activeTab.filePath } : {}),
          autoLog: autoLogEnabled,
          ...(stdinBuffer !== undefined ? { stdin: stdinBuffer } : {}),
          ...(overrideMs !== null ? { timeout: overrideMs } : {}),
          ...(wantsScopeCapture ? { captureScope: true } : {}),
          ...(wantsScopeCapture && typeof scopeDepthPref === 'number'
            ? { scopeDepth: scopeDepthPref }
            : {}),
        });
        setRunDeadlineAt(null);
        // RL-020 Slice 7 — propagate the termination kind.
        const terminationKind: 'success' | 'error' | 'timeout' | 'stopped' =
          result.kind ?? (result.cancelled
            ? 'stopped'
            : result.error
              ? 'error'
              : 'success');
        setRunTermination({
          kind: terminationKind,
          timeoutPreset: result.timeoutPreset,
          timeoutMs: result.timeoutMs,
        });

        // If another execution was triggered while we were running, discard.
        // This includes completed manual flows: once the panel's source is no
        // longer this auto-run, the stale auto result must not write into it.
        if (shouldDiscardAutoResult()) {
          finishAutoRunning();
          return;
        }

        const presentation = toExecutionPresentation(language, code, result);
        // RL-020 Slice 3 fold C — when the run errors AND any watched
        // line did not emit this time, splice the last successful
        // value for that line back into `lineResults` so a pinned
        // watch survives runtime errors on other lines. Only applies
        // to error runs; clean runs replace the array wholesale.
        //
        // RL-020 Slice 5 fold G — extend the splice-back to
        // `autoLog` rows as well. The Slice 1 snapshot already
        // captures them; without this extension a transient runtime
        // error on one line would flicker every auto-log row in the
        // panel to empty until the next clean run.
        let nextLineResults = presentation.lineResults;
        if (result.error) {
          const previousSnapshot = useResultStore.getState().lastSuccessfulSnapshot;
          if (previousSnapshot) {
            const stickyKinds: ReadonlySet<string> = new Set([
              'watch',
              'autoLog',
            ]);
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
        // RL-044 Slice 2b-β-α — Prerequisite fix surfaced during validation.
        // The auto-run path (Scratchpad workflow) historically only
        // rendered `result.stdout` via `setFullOutput`; the bottom
        // console panel reads from `useConsoleStore`, so rich-media
        // payloads emitted via `lingua.{chart,image,html}` never
        // reached `<RichValueChart>` / `<RichValueHtml>` /
        // `<RichValueImage>` in Scratchpad mode. Mirror the manual
        // path (`executeTabManually`) by clearing prior entries and
        // re-pushing this run's stdout/stderr into the store so the
        // panel renders the typed payloads.
        const consoleStore = useConsoleStore.getState();
        consoleStore.clear();
        const entries = toConsoleEntries(result, language as Language);
        for (const entry of entries) {
          consoleStore.addEntry(entry);
        }
        // RL-020 Slice 6 fold G — propagate the worker's consumption
        // summary into the result store so the bottom-panel Input
        // pill can render "Used N of M". `null` clears the badge
        // when this run had no buffer or read zero lines.
        setStdinConsumed(result.stdinConsumed ?? null);
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
          //
          // RL-020 Slice 8 — pass the active language so the
          // Compare toggle can self-gate the snapshot against a
          // later language change.
          captureSuccessfulSnapshot(language);
          // RL-020 Slice 9 — surface the variable inspector
          // snapshot if the worker emitted one. `null` clears any
          // stale snapshot from the previous run.
          useResultStore.getState().setScopeSnapshot(result.scopeSnapshot ?? null);
          // RL-020 Slice 3 fold A — emit telemetry once per clean
          // run that produced at least one magic-comment result, so
          // adoption of `//=>` vs `// @watch` is visible. The
          // closed-enum payload is `{ language, hasArrow, hasWatch }`;
          // the renderer + worker validators reject anything else.
          if (result.magicResults && result.magicResults.length > 0) {
            // Use positive discriminators for both flags so a future
            // runner that emits magic results without an explicit
            // `kind` field doesn't inflate the arrow adoption count
            // by accident. An entry with `kind === undefined`
            // contributes to NEITHER flag — telemetry stays honest
            // until the runner is updated to tag its results.
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
            // RL-020 Slice 5 fold A — per-run adoption signal for
            // auto-log emissions. Bucketed count so the redactor
            // accepts the payload through the closed-enum allowlist
            // (raw counts would require widening `isSafeCount`
            // policy for this event specifically). Fires at most
            // once per clean run that produced ≥1 auto-log result;
            // arrow / watch counts continue to live on the
            // `magic_comment_emitted` event.
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
          // RL-020 Slice 6 fold C — adoption signal for the stdin
          // affordance. Fires once per run whose worker actually
          // pulled at least one line out of the buffer; an unused
          // pre-set buffer stays silent. Closed-enum payload
          // (`language` only) matches the privacy posture of the
          // sibling auto-log events.
          if (
            result.stdinConsumed &&
            result.stdinConsumed.count > 0 &&
            (language === 'javascript' ||
              language === 'typescript' ||
              language === 'python')
          ) {
            void trackEvent('runtime.stdin_used', { language });
          }
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
  }, [
    code,
    language,
    runtimeMode,
    workflowMode,
    autoLogEnabled,
    stdinBuffer,
    activeTab,
    activeTabId,
  ]);

  // Clear results when switching tabs
  useEffect(() => {
    lastRunInputRef.current = null;
    useResultStore.getState().clear();
  }, [activeTabId]);
}
