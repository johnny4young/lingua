import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useStatusNotice } from '../../hooks/useStatusNotice';
import { languageHasRuntimeModes } from '../../../shared/runtimeModes';
import { isJavaScriptFamily, isWorkerRunnerLanguage } from '../../../shared/languageFamilies';
import { isRuntimeTimeoutSupportedLanguage } from '../../../shared/runtimeTimeoutPresets';
import { defaultWorkflowMode } from '../../../shared/workflowMode';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useResultStore } from '../../stores/resultStore';
import { useDependencyDetectionStore } from '../../stores/dependencyDetectionStore';
import { getPendingSessionRestoreTabCount, useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';
import { useUpdateStore } from '../../stores/updateStore';
import { useConsoleStore } from '../../stores/consoleStore';
import { runBenchmark, BENCHMARK_DEFAULT_ITERATIONS } from '../../runtime/benchmarkRun';
import { explainError, formatExplanation } from '../../../shared/errorExplainer';
import {
  detectNativeDependencies,
  type NativePackageLanguage,
} from '../../../shared/dependencies/nativeDependencies';
import { useEntitlement } from '../../hooks/useEntitlement';
import {
  getActiveEditor,
  getActiveEditorCursorLine,
  getActiveEditorLineText,
} from '../../runtime/editorAccess';
import { appendWatchAtLine, isAppendWatchSupported } from '../../utils/appendWatch';
import { trackEvent } from '../../utils/telemetry';
import { exportCapsuleToClipboard } from '../../utils/exportCapsule';
import { renderLanguageScorecardMarkdown } from '../../../shared/languageSupport';
import { markLanguageScorecardSurfaceForNextMount } from '../Settings/languageSupportScorecardTelemetry';
import { markPrivacyDashboardSurfaceForNextMount } from '../Settings/privacyTrustTelemetry';
import { SHARE_LINK_TRIGGER_EVENT } from '../Share/shareLinkEvents';
import { syncVariableInspectorSurfaceAfterToggle } from '../../utils/variableInspectorSurface';
import { bucketVariableCount } from '../../../shared/scopeSnapshot';
import type { Language } from '../../types';
import { buildCommandPaletteModel } from './commandPaletteModel';
import { countCustomLintIssues } from '../../lint/customLintRules';
import { requestPlainPaste } from '../../hooks/useSmartPaste';
import { focusStatusBar } from '../StatusBar/statusBarAccess';
import { copyBootTimingsToClipboard } from '../../utils/bootTimings';
import type { CommandPaletteProps } from './commandPaletteTypes';

export function useCommandPaletteCommands({
  onClose,
  onOpenSettings,
  onOpenWhatsNew,
  onStartGuidedTour,
  onOpenSnippets,
  onOpenProjectSearch,
  onOpenProjectReplace,
  onOpenHttpWorkspace,
  onOpenSqlWorkspace,
  onOpenGoToSymbol,
  onOpenDeveloperUtility,
  onOpenKeyboardShortcuts,
  onRerunLast,
  onNewProjectFromTemplate,
  onReplayEntry,
  onToggleVimMode,
  onOpenCapsuleImport,
  onBrowseCapsules,
  onExportProjectBundle,
  onImportProjectBundle,
  onOpenImportOverlay,
  onOpenRecipes,
  onNewNotebook,
  onExportActiveNotebookLinguanb,
}: CommandPaletteProps) {
  const addTab = useEditorStore(state => state.addTab);
  const openFileFromDisk = useEditorStore(state => state.openFileFromDisk);
  const saveActiveTabAs = useEditorStore(state => state.saveActiveTabAs);
  const duplicateActiveTab = useEditorStore(state => state.duplicateActiveTab);
  const setTabRuntimeMode = useEditorStore(state => state.setTabRuntimeMode);
  const setTabAutoLogEnabled = useEditorStore(state => state.setTabAutoLogEnabled);
  const updateContent = useEditorStore(state => state.updateContent);
  const activeTabId = useEditorStore(state => state.activeTabId);
  const activeTab = useActiveTab();
  const activeRuntimeMode = languageHasRuntimeModes(activeTab?.language)
    ? (activeTab?.runtimeMode ?? 'worker')
    : null;
  const activeWorkflowMode = activeTab
    ? (activeTab.workflowMode ?? defaultWorkflowMode(activeTab.language))
    : null;
  const activeTimeoutLanguage =
    activeTab && isRuntimeTimeoutSupportedLanguage(activeTab.language) ? activeTab.language : null;
  const isAutoLogCommandEligible =
    activeTab !== null &&
    isJavaScriptFamily(activeTab.language) &&
    activeWorkflowMode === 'scratchpad';
  // RL-020 Slice 3 fold E — surface the active tab's language to the
  // palette model so the "Pin watch on current line" action only
  // appears for JS / TS / Python.
  const activeWatchLanguage = activeTab?.language ?? null;
  const { snippets } = useSnippetsStore();
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const canBenchmark = useEntitlement('BENCHMARK');
  const canExplainError = useEntitlement('LOCAL_AI');
  // F-1 — Go/Rust/Ruby install: detect the active saved tab's third-party
  // deps so the palette can offer a one-shot toolchain install.
  const nativeDepLanguage: NativePackageLanguage | null =
    activeTab && ['go', 'rust', 'ruby'].includes(activeTab.language)
      ? (activeTab.language as NativePackageLanguage)
      : null;
  const nativeDepSpecifiers =
    nativeDepLanguage && activeTab
      ? detectNativeDependencies(nativeDepLanguage, activeTab.content)
      : [];
  const executionHistory = useExecutionHistoryStore(state => state.entries);
  // RL-094 Slice 1 fold B — read the latest capsule (newest-first walk
  // inside the store). Recomputes when `entries` changes; the
  // selector is cheap (returns null when no entry carries one).
  const latestCapsule = useExecutionHistoryStore(state => state.latestCapsule());
  const snapshotRing = useResultStore(state => state.snapshotRing);
  const dependencyDetectionEnabled = useSettingsStore(state => state.dependencyDetectionEnabled);
  const dependencyDetectionEntry = useDependencyDetectionStore(state =>
    activeTabId ? (state.byTab.get(activeTabId) ?? null) : null
  );
  const dependenciesPanelAvailable =
    dependencyDetectionEnabled &&
    activeTab !== null &&
    dependencyDetectionEntry !== null &&
    dependencyDetectionEntry.language === activeTab.language &&
    (dependencyDetectionEntry.dependencies.length > 0 ||
      dependencyDetectionEntry.skippedReason !== undefined);
  const { setLayoutPreset } = useSettingsStore();
  const vimMode = useSettingsStore(state => state.vimMode);
  // RL-112 fold C — gate the "Focus status bar" palette command on the bar's
  // current visibility so it never offers to focus a hidden bar.
  const showStatusBar = useSettingsStore(state => state.showStatusBar);
  // RL-111 fold D — gates the "Restore last session" palette command. When
  // ask-mode boot pinned a previous-session snapshot, prefer that in-memory
  // count over the auto-save store's current value so the palette fallback stays
  // aligned with the boot prompt after the toast dismisses.
  const savedSessionTabCount = useSessionStore(state => {
    const pendingCount = getPendingSessionRestoreTabCount();
    return pendingCount > 0 ? pendingCount : state.savedTabs.length;
  });
  const { checkForUpdates, restartToApply, status: updateStatus } = useUpdateStore();
  const { t, i18n } = useTranslation();
  const { info, success, warning } = useStatusNotice();

  // RL-028 third slice — when the user picks a recent-run entry, try to
  // focus a tab that matches the run's language. If there isn't one
  // open today we just close the palette (the action is informational
  // until Slice D of RL-028 wires an actual replay path).
  const focusLanguageTab = (language: Language) => {
    const { tabs, setActiveTab } = useEditorStore.getState();
    const match = tabs.find(tab => tab.language === language);
    if (match) setActiveTab(match.id);
  };

  const allCommands = useMemo(() => {
    return buildCommandPaletteModel({
      templates: BUILT_IN_TEMPLATES,
      snippets,
      executionHistory: canUseExecutionHistory ? executionHistory : [],
      onFocusLanguageTab: focusLanguageTab,
      onRerunLast: canUseExecutionHistory ? onRerunLast : undefined,
      onNewProjectFromTemplate,
      // RL-111 fold D — restore the pending ask-mode boot snapshot when one
      // exists; otherwise restore the currently persisted session on demand.
      // The model hides the command when no snapshot tab exists, so a fresh user
      // never sees a no-op entry.
      onRestoreSession: () => {
        void useSessionStore.getState().restoreSession();
      },
      savedSessionTabCount,
      // RL-108 fold B — toggle inline lint for the active language, surfaced
      // only on a lintable JS/TS tab. Flips the per-language setting.
      onToggleInlineLint:
        activeTab && (activeTab.language === 'javascript' || activeTab.language === 'typescript')
          ? () => {
              const { inlineLintEnabledByLanguage, setInlineLintEnabled } =
                useSettingsStore.getState();
              setInlineLintEnabled(
                activeTab.language,
                inlineLintEnabledByLanguage[activeTab.language] === false
              );
            }
          : undefined,
      // RL-108 fold D — preview the active JS/TS buffer's custom-lint issue
      // count on the toggle command. Pure scan (no Monaco), so it stays cheap
      // even though the model is rebuilt on every palette open.
      inlineLintActiveIssueCount: activeTab
        ? countCustomLintIssues(activeTab.content, activeTab.language)
        : 0,
      // RL-110 fold D — "Paste as plain text" surfaced only when an editor
      // tab is active. Drives the same bypass as Cmd+Shift+V via the active
      // editor handle (no-op if the editor went away between open and click).
      onPastePlainText: activeTab
        ? () => {
            const editor = getActiveEditor();
            if (editor) requestPlainPaste(editor);
          }
        : undefined,
      // RL-112 fold C — toggle the persistent status bar (always wired) and
      // focus its first segment (only when the bar is visible, so the palette
      // never offers to focus a hidden bar).
      onToggleStatusBar: () => {
        const { showStatusBar, setShowStatusBar } = useSettingsStore.getState();
        setShowStatusBar(!showStatusBar);
      },
      // F-5 — benchmark the active tab. Gated on the BENCHMARK entitlement
      // AND a worker-runner language (JS/TS/Python/Ruby) with non-empty
      // source, so the command is hidden for Free users and unbenchmarkable
      // tabs. Results are reported to the console.
      onBenchmarkActiveTab:
        canBenchmark &&
        activeTab &&
        isWorkerRunnerLanguage(activeTab.language) &&
        activeTab.content.trim().length > 0
          ? () => {
              const tab = activeTab;
              const console = useConsoleStore.getState();
              const ui = useUIStore.getState();
              ui.openBottomPanel('console');
              console.addEntry({
                type: 'info',
                content: t('benchmark.console.start', {
                  count: BENCHMARK_DEFAULT_ITERATIONS,
                  name: tab.name,
                }),
              });
              void runBenchmark({
                code: tab.content,
                language: tab.language,
                runtimeMode: activeRuntimeMode ?? undefined,
                iterations: BENCHMARK_DEFAULT_ITERATIONS,
              }).then(result => {
                const store = useConsoleStore.getState();
                if (!result.ok) {
                  store.addEntry({
                    type: 'error',
                    content:
                      result.reason === 'run-error'
                        ? t('benchmark.console.runError', {
                            message: result.message ?? '',
                          })
                        : t('benchmark.console.noSamples'),
                  });
                  return;
                }
                const { stats } = result;
                const fmt = (value: number) => `${value.toFixed(2)}ms`;
                store.addEntry({
                  type: 'result',
                  content: t('benchmark.console.report', {
                    runs: stats.runs,
                    mean: fmt(stats.mean),
                    median: fmt(stats.median),
                    min: fmt(stats.min),
                    max: fmt(stats.max),
                    p95: fmt(stats.p95),
                    stdev: fmt(stats.stdev),
                  }),
                });
              });
            }
          : undefined,
      // F-2 — explain the last run error via the offline explainer. Gated
      // on LOCAL_AI and on there actually being an error to explain.
      onExplainLastError:
        canExplainError && useResultStore.getState().error
          ? () => {
              const runError = useResultStore.getState().error;
              if (!runError) return;
              const explanation = explainError({
                message: runError.message,
                language: activeTab?.language,
              });
              const console = useConsoleStore.getState();
              useUIStore.getState().openBottomPanel('console');
              console.addEntry({
                type: 'info',
                content: `${t('command.explainError')}\n\n${formatExplanation(explanation)}`,
              });
            }
          : undefined,
      // F-1 — install detected Go/Rust/Ruby packages via the desktop
      // toolchain. Wired only for a saved native-language tab with
      // detected third-party deps and the desktop install bridge present.
      onInstallNativeDependencies:
        nativeDepLanguage &&
        activeTab?.filePath &&
        nativeDepSpecifiers.length > 0 &&
        typeof window !== 'undefined' &&
        window.lingua?.dependencies?.installNative
          ? () => {
              const language = nativeDepLanguage;
              const filePath = activeTab.filePath;
              const specifiers = nativeDepSpecifiers;
              const bridge = window.lingua?.dependencies?.installNative;
              if (!filePath || !bridge) return;
              const store = useConsoleStore.getState();
              useUIStore.getState().openBottomPanel('console');
              store.addEntry({
                type: 'info',
                content: t('command.installNativeDeps.start', {
                  count: specifiers.length,
                  packages: specifiers.join(', '),
                }),
              });
              void bridge(language, specifiers, filePath).then(result => {
                const console = useConsoleStore.getState();
                if (result.status === 'success') {
                  console.addEntry({
                    type: 'result',
                    content: t('command.installNativeDeps.success', {
                      count: specifiers.length,
                    }),
                  });
                } else {
                  console.addEntry({
                    type: 'error',
                    content: t('command.installNativeDeps.failure', {
                      reason: result.error ?? result.status,
                    }),
                  });
                }
              });
            }
          : undefined,
      onFocusStatusBar: showStatusBar ? () => focusStatusBar() : undefined,
      onReplayEntry: canUseExecutionHistory ? onReplayEntry : undefined,
      onToggleVimMode,
      vimModeEnabled: vimMode,
      // RL-019 Slice 1 fold E — palette wiring. Gate on
      // `activeRuntimeMode !== null` (the JS/TS marker), not just
      // `activeTabId`, so a Python / Go / Rust tab never wires the
      // callback. The model already short-circuits when the field
      // is null; this is the tighter invariant at the call site.
      onSetRuntimeMode:
        activeRuntimeMode !== null && activeTabId
          ? mode => setTabRuntimeMode(activeTabId, mode)
          : undefined,
      activeRuntimeMode,
      // RL-020 Slice 3 fold E — read the editor's current line text,
      // delegate to the pure `appendWatchAtLine` helper, write the
      // updated buffer back via `updateContent`. The pure helper
      // returns `null` when the line has no expression (empty,
      // already-watched, comment-only) — in that case we surface a
      // localized notice via the status banner instead of mutating
      // the buffer silently.
      onAddWatchToCurrentLine:
        activeTabId && activeTab && isAppendWatchSupported(activeTab.language)
          ? () => {
              const cursorLine = getActiveEditorCursorLine();
              const lineText = getActiveEditorLineText();
              if (cursorLine === null || lineText === null) {
                info('commandPalette.action.addWatch.unsupported');
                return;
              }
              const next = appendWatchAtLine(
                activeTab.content,
                cursorLine,
                activeTab.language as 'javascript' | 'typescript' | 'python'
              );
              if (next === null) {
                info('commandPalette.action.addWatch.unsupported');
                return;
              }
              updateContent(activeTabId, next);
            }
          : undefined,
      activeWatchLanguage,
      // RL-020 Slice 5 fold D — toggle auto-log on the active JS / TS
      // tab. Resolution mirrors `useAutoRun`: per-tab override wins
      // over per-language Settings default. Callback flips the
      // RESOLVED state's opposite via `setTabAutoLogEnabled` so the
      // toolbar segment + status pill update on the next render.
      onToggleAutoLogOnActiveTab:
        activeTabId && activeTab && isAutoLogCommandEligible
          ? () => {
              const settings = useSettingsStore.getState();
              const resolved =
                activeTab.autoLogEnabled === undefined
                  ? settings.scratchpadAutoLogByLanguage[activeTab.language] === true
                  : activeTab.autoLogEnabled === true;
              setTabAutoLogEnabled(activeTabId, !resolved);
            }
          : undefined,
      activeAutoLogResolved:
        activeTab && isAutoLogCommandEligible
          ? activeTab.autoLogEnabled === undefined
            ? useSettingsStore.getState().scratchpadAutoLogByLanguage[activeTab.language] === true
            : activeTab.autoLogEnabled === true
          : false,
      // RL-020 Slice 6 fold E — focus the Input bottom-panel tab.
      // Hidden when the master Settings toggle is OFF or when the
      // active tab's language can't consume stdin (anything outside
      // JS / TS / Python, or runtime mode browser-preview).
      onFocusStdinPanel:
        activeTab &&
        useSettingsStore.getState().showStdinPanel &&
        isWorkerRunnerLanguage(activeTab.language) &&
        activeTab.runtimeMode !== 'browser-preview'
          ? () => useUIStore.getState().openBottomPanel('stdin')
          : undefined,
      stdinPanelAvailable:
        !!activeTab &&
        useSettingsStore.getState().showStdinPanel &&
        isWorkerRunnerLanguage(activeTab.language) &&
        activeTab.runtimeMode !== 'browser-preview',
      // RL-020 Slice 7 fold C — set the per-language timeout preset
      // for the active language from the palette. Only surfaces on
      // the supported language set.
      activeTimeoutLanguage,
      activeTimeoutPreset: activeTimeoutLanguage
        ? (useSettingsStore.getState().runtimeTimeoutPresetByLanguage?.[activeTimeoutLanguage] ??
          null)
        : null,
      onSetActiveLanguageTimeoutPreset: activeTimeoutLanguage
        ? preset => {
            useSettingsStore.getState().setRuntimeTimeoutPreset(activeTimeoutLanguage, preset);
          }
        : undefined,
      // RL-020 Slice 7 fold D — "Run with extended timeout"
      // one-shot. Sets the per-tab override + triggers the manual
      // run via the parent-provided runActiveTab callback. Hidden
      // when the active tab isn't runnable or the parent didn't
      // wire `onRerunLast` (we reuse that signal as the "manual run
      // available" gate so the entry only surfaces where Run is
      // actually possible).
      onRunWithExtendedTimeout:
        activeTimeoutLanguage && activeTabId && onRerunLast
          ? () => {
              // 5 min one-shot override. Mirrors the `extended` preset
              // ceiling so the upper bound is consistent with the
              // Settings copy.
              useEditorStore.getState().setTabNextRunTimeoutOverride(activeTabId, 300_000);
              onRerunLast();
            }
          : undefined,
      // RL-020 Slice 8 fold C — palette toggle for the Compare
      // panel. Reuses `setTabCompareEnabled` so the source of
      // truth stays per-tab. The gate (`compareSnapshotAvailable`)
      // matches the toggle-button gate so the palette never
      // advertises an action it would refuse.
      onToggleCompareWithSnapshot:
        activeTab && activeTabId
          ? () => {
              const next = activeTab.compareWithSnapshotEnabled !== true;
              useEditorStore.getState().setTabCompareEnabled(activeTabId, next);
              void trackEvent('runtime.compare_view_toggled', {
                language: activeTab.language,
                enabled: next,
              });
            }
          : undefined,
      activeCompareEnabled: activeTab?.compareWithSnapshotEnabled === true,
      compareSnapshotAvailable: (() => {
        return (
          activeTab !== null && snapshotRing.some(entry => entry.language === activeTab.language)
        );
      })(),
      // RL-020 Slice 9 fold B — variable inspector palette entry.
      onToggleVariableInspector:
        activeTab && activeTabId
          ? () => {
              const next = activeTab.variableInspectorEnabled !== true;
              useEditorStore.getState().setTabVariableInspectorEnabled(activeTabId, next);
              syncVariableInspectorSurfaceAfterToggle(next);
              const snapshot = useResultStore.getState().scopeSnapshot;
              const bucket = snapshot ? bucketVariableCount(snapshot.variables.length) : '0';
              void trackEvent('runtime.variable_inspector_opened', {
                language: activeTab.language,
                variableCount: bucket,
              });
            }
          : undefined,
      activeVariableInspectorEnabled: activeTab?.variableInspectorEnabled === true,
      variableInspectorScopeAvailable: (() => {
        if (!activeTab) return false;
        if (activeTab.runtimeMode === 'node') return false;
        const snapshot = useResultStore.getState().scopeSnapshot;
        return snapshot != null && snapshot.language === activeTab.language;
      })(),
      // RL-020 Slice 4 fold G — pass the active tab id so the
      // model can surface the per-tab Recent runs group above the
      // legacy global one. `null` (no active tab) suppresses the
      // group; existing behavior is unchanged.
      activeTabId: activeTabId ?? null,
      updateStatus,
      createTab: addTab,
      createDefaultTab,
      setLayoutPreset,
      onClose,
      onOpenSettings,
      onOpenWhatsNew,
      onStartGuidedTour,
      onOpenSnippets,
      onOpenProjectSearch,
      onOpenProjectReplace,
      onOpenHttpWorkspace,
      onOpenSqlWorkspace,
      onOpenGoToSymbol,
      onOpenDeveloperUtility,
      onOpenKeyboardShortcuts,
      checkForUpdates,
      restartToApply,
      openFileFromDisk,
      saveActiveTabAs,
      duplicateActiveTab,
      // RL-094 Slice 1 fold B — export latest capsule via the palette.
      // Mirrors the Settings → Account → Run Capsules export flow:
      // sanitize, JSON.stringify (pretty), clipboard write, status
      // notice. Telemetry tagged `palette-export` so dashboards split
      // adoption from the Settings entry.
      onExportLatestCapsule: latestCapsule
        ? () => {
            void exportCapsuleToClipboard(latestCapsule, 'palette-export').then(result => {
              if (result.ok) {
                success('settings.account.runCapsules.copiedNotice');
              } else {
                warning('results.actions.exportCapsule.clipboardUnavailable');
              }
            });
          }
        : undefined,
      latestCapsuleAvailable: latestCapsule !== null,
      onOpenCapsuleImport,
      onBrowseCapsules,
      onExportProjectBundle,
      onImportProjectBundle,
      onOpenImportOverlay,
      onOpenRecipes,
      onNewNotebook,
      onExportActiveNotebookLinguanb,
      // RL-095 Slice 1 fold B — open Settings on the Languages tab and
      // scroll to the scorecard. Three pieces of choreography:
      //   1. Claim the next scorecard mount as `surface: 'palette'`
      //      via the module-level helper so the IntersectionObserver
      //      fires exactly one telemetry event with the right tag.
      //   2. Open the Settings overlay (the model wrapper has already
      //      called `onClose()` first, so this overlay state wins).
      //   3. Dispatch `lingua-settings-navigate-tab` so SettingsModal
      //      jumps to the Languages tab before the scroll target is
      //      queried. The event listener lives in SettingsModal so
      //      we never grow a global "active settings tab" store.
      onShowLanguageSupport: () => {
        markLanguageScorecardSurfaceForNextMount('palette');
        onOpenSettings();
        // Two `requestAnimationFrame` ticks: the first lets
        // SettingsModal mount and register its
        // `lingua-settings-navigate-tab` listener; the second lets
        // `LanguagesSection` mount the scorecard after the tab
        // change before we try to scroll it into view. A synchronous
        // dispatch right after `onOpenSettings()` would race the
        // mount and be lost.
        window.requestAnimationFrame(() => {
          window.dispatchEvent(
            new CustomEvent('lingua-settings-navigate-tab', {
              detail: 'languages',
            })
          );
          window.requestAnimationFrame(() => {
            const node = document.querySelector('[data-testid="language-support-scorecard"]');
            if (node) {
              node.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          });
        });
      },
      // RL-036 Phase A1 fold C — dispatch the share trigger event;
      // the always-mounted `<ShareLinkController>` picks it up and
      // runs the same flow as the header button, with `trigger:
      // 'palette'` so telemetry attributes correctly. Hide the
      // command when there is no active tab so it never advertises a
      // no-op.
      onCopyShareLink: activeTab
        ? () => {
            window.dispatchEvent(
              new CustomEvent(SHARE_LINK_TRIGGER_EVENT, {
                detail: { trigger: 'palette' },
              })
            );
          }
        : undefined,
      // RL-101 Slice 1 fold G — three palette entries that re-arm a
      // single stage each. Each callback reads the setter from the
      // settings store at click time so a fresh slice always lands
      // even if the user opened the palette before the store mounted.
      onReplayOnboardingWelcome: () => {
        useSettingsStore.getState().resetOnboardingWelcome();
        info('onboarding.notice.welcomeReplay');
      },
      onReplayOnboardingFirstRun: () => {
        useSettingsStore.getState().resetOnboardingFirstRun();
      },
      onReplayOnboardingFirstSnippet: () => {
        useSettingsStore.getState().resetOnboardingFirstSnippet();
      },
      // RL-096 Slice 1 fold B — open Settings on the Privacy tab.
      // Mirrors the `onShowLanguageSupport` choreography from RL-095:
      // claim the next PrivacyTrustSection mount as `surface:
      // 'palette'`, open Settings overlay, then dispatch the navigate
      // event on the next animation frame so SettingsModal's listener
      // has mounted before we fire.
      onShowPrivacyDashboard: () => {
        markPrivacyDashboardSurfaceForNextMount('palette');
        onOpenSettings();
        window.requestAnimationFrame(() => {
          window.dispatchEvent(
            new CustomEvent('lingua-settings-navigate-tab', {
              detail: 'privacy',
            })
          );
        });
      },
      // RL-025 Slice A fold C — open the bottom-panel Dependencies
      // tab. Same overlay-survival pattern as the language /
      // privacy entries: the action body in the model already calls
      // `onClose()` first; here we simply ask the UI store to focus
      // the tab. The tab self-gates on count > 0 so a stale
      // activation when the panel is hidden becomes a no-op.
      onShowDependencies: dependenciesPanelAvailable
        ? () => {
            useUIStore.getState().openBottomPanel('dependencies');
          }
        : undefined,
      // RL-095 Slice 1 fold F — render + copy markdown to clipboard.
      // Slice 2 fold A: honor the scorecard's sticky platform filter so the
      // clipboard payload matches what the user sees (and the matching
      // per-platform section in docs/CAPABILITY_MATRIX.md). Default `all`
      // reproduces the original cross-platform table verbatim.
      onCopyLanguageScorecardMarkdown: () => {
        const markdown = renderLanguageScorecardMarkdown(
          undefined,
          useSettingsStore.getState().languageScorecardPlatform
        );
        const writer = navigator.clipboard?.writeText;
        if (typeof writer === 'function') {
          void writer
            .call(navigator.clipboard, markdown)
            .then(() => {
              success('commandPalette.action.copyLanguageScorecardMarkdown.copied');
            })
            .catch(() => {
              warning('commandPalette.action.copyLanguageScorecardMarkdown.clipboardUnavailable');
            });
        } else {
          warning('commandPalette.action.copyLanguageScorecardMarkdown.clipboardUnavailable');
        }
      },
      onCopyBootTimings: () => {
        void copyBootTimingsToClipboard()
          .then(copied => {
            if (copied) {
              success('commandPalette.action.copyBootTimings.copied');
            } else {
              warning('commandPalette.action.copyBootTimings.clipboardUnavailable');
            }
          })
          .catch(() => {
            warning('commandPalette.action.copyBootTimings.clipboardUnavailable');
          });
      },
      t,
    });
    // Re-build when the active language changes so labels/descriptions
    // follow i18next. `t` itself has a stable identity in react-i18next,
    // so depend on `i18n.language` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    snippets,
    canUseExecutionHistory,
    executionHistory,
    snapshotRing,
    onRerunLast,
    onNewProjectFromTemplate,
    onReplayEntry,
    onToggleVimMode,
    vimMode,
    showStatusBar,
    activeTabId,
    activeRuntimeMode,
    activeTimeoutLanguage,
    setTabRuntimeMode,
    addTab,
    setLayoutPreset,
    onClose,
    onOpenSettings,
    onOpenSnippets,
    onOpenProjectSearch,
    onOpenProjectReplace,
    onOpenHttpWorkspace,
    onOpenSqlWorkspace,
    onOpenGoToSymbol,
    onOpenDeveloperUtility,
    onOpenKeyboardShortcuts,
    checkForUpdates,
    restartToApply,
    updateStatus,
    openFileFromDisk,
    saveActiveTabAs,
    duplicateActiveTab,
    activeWatchLanguage,
    updateContent,
    activeTab,
    setTabAutoLogEnabled,
    latestCapsule,
    savedSessionTabCount,
    i18n.language,
    info,
    success,
    warning,
  ]);
  return allCommands;
}
