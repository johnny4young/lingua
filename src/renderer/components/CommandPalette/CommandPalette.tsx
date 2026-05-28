import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { languageHasRuntimeModes } from '../../../shared/runtimeModes';
import { isRuntimeTimeoutSupportedLanguage } from '../../../shared/runtimeTimeoutPresets';
import { defaultWorkflowMode } from '../../../shared/workflowMode';
import {
  type ExecutionHistoryEntry,
  useExecutionHistoryStore,
} from '../../stores/executionHistoryStore';
import { useResultStore } from '../../stores/resultStore';
import { useDependencyDetectionStore } from '../../stores/dependencyDetectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';
import { useUpdateStore } from '../../stores/updateStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import {
  getActiveEditorCursorLine,
  getActiveEditorLineText,
} from '../../runtime/editorAccess';
import {
  appendWatchAtLine,
  isAppendWatchSupported,
} from '../../utils/appendWatch';
import { trackEvent } from '../../utils/telemetry';
import { exportCapsuleToClipboard } from '../../utils/exportCapsule';
import { renderLanguageScorecardMarkdown } from '../../../shared/languageSupport';
import { markLanguageScorecardSurfaceForNextMount } from '../Settings/languageSupportScorecardTelemetry';
import { markPrivacyDashboardSurfaceForNextMount } from '../Settings/privacyTrustTelemetry';
import { SHARE_LINK_TRIGGER_EVENT } from '../Share/shareLinkEvents';
import { syncVariableInspectorSurfaceAfterToggle } from '../../utils/variableInspectorSurface';
import { bucketVariableCount } from '../../../shared/scopeSnapshot';
import type { Language } from '../../types';
import { Kbd, OverlayBackdrop, OverlayCard, Tooltip } from '../ui/chrome';
import { handleCloseOnEscape } from '../ui/keyboard';
import { CommandPaletteResults } from './CommandPaletteResults';
import {
  buildCommandPaletteModel,
  filterCommandPaletteCommands,
} from './commandPaletteModel';

interface CommandPaletteProps {
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  onStartGuidedTour: () => void;
  onOpenSnippets: () => void;
  onOpenProjectSearch?: () => void;
  onOpenProjectReplace?: () => void;
  onOpenHttpWorkspace?: () => void;
  onOpenSqlWorkspace?: () => void;
  onOpenGoToSymbol?: () => void;
  onOpenDeveloperUtility?: (id: DeveloperUtilityId) => void;
  onOpenKeyboardShortcuts?: () => void;
  /**
   * RL-028 fourth slice — fires the "Re-run last execution" palette
   * action. Owned by the AppChrome layer so the palette doesn't have
   * to know about runner internals.
   */
  onRerunLast?: () => void;
  /**
   * RL-103 Slice 1 fold C — fires the "New project from template…"
   * palette action. The handler typically focuses the Welcome screen
   * (or opens it) so the user picks a card.
   */
  onNewProjectFromTemplate?: () => void;
  /**
   * RL-028 sixth slice trailer — fires when the user activates a
   * per-entry "Replay {language} run …" palette action. The handler
   * dispatches `replayHistoryEntry(entry, ...)` so the run does not
   * append another history entry.
   */
  onReplayEntry?: (entry: ExecutionHistoryEntry) => void;
  /**
   * RL-037 Vim slice — fires the "Toggle Vim mode" palette action.
   * Optional; when omitted the command is hidden.
   */
  onToggleVimMode?: () => void;
  /**
   * RL-094 Slice 2 — fires the "Import capsule from JSON" palette
   * action. Caller (App.tsx) opens the `capsule-import` AppOverlay.
   * Optional; when omitted the action hides so the model stays
   * honest about wired surfaces.
   */
  onOpenCapsuleImport?: () => void;
  onOpenImportOverlay?: () => void;
  /**
   * RL-039 Slice B fold A — opens the Recipes overlay (`Mod+Alt+L`).
   */
  onOpenRecipes?: () => void;
  /**
   * RL-043 Slice A fold A — creates a fresh notebook tab (`Mod+Alt+N`).
   */
  onNewNotebook?: () => void;
}

export function CommandPalette({
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
  onOpenImportOverlay,
  onOpenRecipes,
  onNewNotebook,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const {
    addTab,
    openFileFromDisk,
    saveActiveTabAs,
    duplicateActiveTab,
    setTabRuntimeMode,
    setTabAutoLogEnabled,
    updateContent,
  } = useEditorStore();
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const tabs = useEditorStore((state) => state.tabs);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeRuntimeMode = languageHasRuntimeModes(activeTab?.language)
    ? (activeTab?.runtimeMode ?? 'worker')
    : null;
  const activeWorkflowMode = activeTab
    ? activeTab.workflowMode ?? defaultWorkflowMode(activeTab.language)
    : null;
  const activeTimeoutLanguage =
    activeTab && isRuntimeTimeoutSupportedLanguage(activeTab.language)
      ? activeTab.language
      : null;
  const isAutoLogCommandEligible =
    activeTab !== undefined &&
    (activeTab.language === 'javascript' ||
      activeTab.language === 'typescript') &&
    activeWorkflowMode === 'scratchpad';
  // RL-020 Slice 3 fold E — surface the active tab's language to the
  // palette model so the "Pin watch on current line" action only
  // appears for JS / TS / Python.
  const activeWatchLanguage = activeTab?.language ?? null;
  const { snippets } = useSnippetsStore();
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const executionHistory = useExecutionHistoryStore((state) => state.entries);
  // RL-094 Slice 1 fold B — read the latest capsule (newest-first walk
  // inside the store). Recomputes when `entries` changes; the
  // selector is cheap (returns null when no entry carries one).
  const latestCapsule = useExecutionHistoryStore((state) =>
    state.latestCapsule()
  );
  const snapshotRing = useResultStore((state) => state.snapshotRing);
  const dependencyDetectionEnabled = useSettingsStore(
    (state) => state.dependencyDetectionEnabled
  );
  const dependencyDetectionEntry = useDependencyDetectionStore((state) =>
    activeTabId ? state.byTab.get(activeTabId) ?? null : null
  );
  const dependenciesPanelAvailable =
    dependencyDetectionEnabled &&
    activeTab !== undefined &&
    dependencyDetectionEntry !== null &&
    dependencyDetectionEntry.language === activeTab.language &&
    (dependencyDetectionEntry.dependencies.length > 0 ||
      dependencyDetectionEntry.skippedReason !== undefined);
  const { setLayoutPreset } = useSettingsStore();
  const vimMode = useSettingsStore((state) => state.vimMode);
  const { checkForUpdates, restartToApply, status: updateStatus } = useUpdateStore();
  const { t, i18n } = useTranslation();

  // RL-028 third slice — when the user picks a recent-run entry, try to
  // focus a tab that matches the run's language. If there isn't one
  // open today we just close the palette (the action is informational
  // until Slice D of RL-028 wires an actual replay path).
  const focusLanguageTab = (language: Language) => {
    const { tabs, setActiveTab } = useEditorStore.getState();
    const match = tabs.find((tab) => tab.language === language);
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
          ? (mode) => setTabRuntimeMode(activeTabId, mode)
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
                useUIStore.getState().pushStatusNotice({
                  tone: 'info',
                  messageKey: 'commandPalette.action.addWatch.unsupported',
                });
                return;
              }
              const next = appendWatchAtLine(
                activeTab.content,
                cursorLine,
                activeTab.language as 'javascript' | 'typescript' | 'python'
              );
              if (next === null) {
                useUIStore.getState().pushStatusNotice({
                  tone: 'info',
                  messageKey: 'commandPalette.action.addWatch.unsupported',
                });
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
            ? useSettingsStore.getState().scratchpadAutoLogByLanguage[
                activeTab.language
              ] === true
            : activeTab.autoLogEnabled === true
          : false,
      // RL-020 Slice 6 fold E — focus the Input bottom-panel tab.
      // Hidden when the master Settings toggle is OFF or when the
      // active tab's language can't consume stdin (anything outside
      // JS / TS / Python, or runtime mode browser-preview).
      onFocusStdinPanel:
        activeTab &&
        useSettingsStore.getState().showStdinPanel &&
        (activeTab.language === 'javascript' ||
          activeTab.language === 'typescript' ||
          activeTab.language === 'python') &&
        activeTab.runtimeMode !== 'browser-preview'
          ? () => useUIStore.getState().openBottomPanel('stdin')
          : undefined,
      stdinPanelAvailable:
        !!activeTab &&
        useSettingsStore.getState().showStdinPanel &&
        (activeTab.language === 'javascript' ||
          activeTab.language === 'typescript' ||
          activeTab.language === 'python') &&
        activeTab.runtimeMode !== 'browser-preview',
      // RL-020 Slice 7 fold C — set the per-language timeout preset
      // for the active language from the palette. Only surfaces on
      // the supported language set.
      activeTimeoutLanguage,
      activeTimeoutPreset: activeTimeoutLanguage
        ? (useSettingsStore.getState().runtimeTimeoutPresetByLanguage?.[
            activeTimeoutLanguage
          ] ?? null)
        : null,
      onSetActiveLanguageTimeoutPreset:
        activeTimeoutLanguage
          ? (preset) => {
              useSettingsStore
                .getState()
                .setRuntimeTimeoutPreset(activeTimeoutLanguage, preset);
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
              useEditorStore
                .getState()
                .setTabNextRunTimeoutOverride(activeTabId, 300_000);
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
              useEditorStore
                .getState()
                .setTabCompareEnabled(activeTabId, next);
              void trackEvent('runtime.compare_view_toggled', {
                language: activeTab.language,
                enabled: next,
              });
            }
          : undefined,
      activeCompareEnabled:
        activeTab?.compareWithSnapshotEnabled === true,
      compareSnapshotAvailable: (() => {
        return (
          activeTab !== undefined &&
          snapshotRing.some((entry) => entry.language === activeTab.language)
        );
      })(),
      // RL-020 Slice 9 fold B — variable inspector palette entry.
      onToggleVariableInspector:
        activeTab && activeTabId
          ? () => {
              const next = activeTab.variableInspectorEnabled !== true;
              useEditorStore
                .getState()
                .setTabVariableInspectorEnabled(activeTabId, next);
              syncVariableInspectorSurfaceAfterToggle(next);
              const snapshot = useResultStore.getState().scopeSnapshot;
              const bucket = snapshot
                ? bucketVariableCount(snapshot.variables.length)
                : '0';
              void trackEvent('runtime.variable_inspector_opened', {
                language: activeTab.language,
                variableCount: bucket,
              });
            }
          : undefined,
      activeVariableInspectorEnabled:
        activeTab?.variableInspectorEnabled === true,
      variableInspectorScopeAvailable: (() => {
        if (!activeTab) return false;
        if (activeTab.runtimeMode === 'node') return false;
        const snapshot = useResultStore.getState().scopeSnapshot;
        return (
          snapshot != null && snapshot.language === activeTab.language
        );
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
            void exportCapsuleToClipboard(
              latestCapsule,
              'palette-export'
            ).then((result) => {
              useUIStore.getState().pushStatusNotice(
                result.ok
                  ? {
                      tone: 'success',
                      messageKey:
                        'settings.account.runCapsules.copiedNotice',
                    }
                  : {
                      tone: 'warning',
                      // RL-094 Slice 1.5 — converged on the
                      // `results.actions.exportCapsule.clipboardUnavailable`
                      // key so palette, keyboard shortcut, and result-
                      // panel surfaces share one source of truth for
                      // the failure copy.
                      messageKey:
                        'results.actions.exportCapsule.clipboardUnavailable',
                    }
              );
            });
          }
        : undefined,
      latestCapsuleAvailable: latestCapsule !== null,
      onOpenCapsuleImport,
      onOpenImportOverlay,
      onOpenRecipes,
      onNewNotebook,
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
            const node = document.querySelector(
              '[data-testid="language-support-scorecard"]'
            );
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
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'onboarding.notice.welcomeReplay',
        });
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
      onCopyLanguageScorecardMarkdown: () => {
        const markdown = renderLanguageScorecardMarkdown();
        const writer = navigator.clipboard?.writeText;
        if (typeof writer === 'function') {
          void writer
            .call(navigator.clipboard, markdown)
            .then(() => {
              useUIStore.getState().pushStatusNotice({
                tone: 'success',
                messageKey:
                  'commandPalette.action.copyLanguageScorecardMarkdown.copied',
              });
            })
            .catch(() => {
              useUIStore.getState().pushStatusNotice({
                tone: 'warning',
                messageKey:
                  'commandPalette.action.copyLanguageScorecardMarkdown.clipboardUnavailable',
              });
            });
        } else {
          useUIStore.getState().pushStatusNotice({
            tone: 'warning',
            messageKey:
              'commandPalette.action.copyLanguageScorecardMarkdown.clipboardUnavailable',
          });
        }
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
    i18n.language,
  ]);

  const filtered = useMemo(() => {
    return filterCommandPaletteCommands(allCommands, query);
  }, [allCommands, query]);
  const visibleSelectedIndex =
    filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${visibleSelectedIndex}"]`
    );
    element?.scrollIntoView({ block: 'nearest' });
  }, [visibleSelectedIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((currentIndex) => Math.min(currentIndex + 1, filtered.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((currentIndex) => Math.max(currentIndex - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      filtered[visibleSelectedIndex]?.action();
      return;
    }

    handleCloseOnEscape(event, onClose);
  };

  return (
    <OverlayBackdrop align="top" onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.item.commandPalette.label')}
        className="w-full max-w-2xl"
      >
        <div className="surface-header flex items-center gap-3 px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            data-tour-id="command-palette-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.search.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          {query && (
            <Tooltip content={t('commandPalette.search.clear')}>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSelectedIndex(0);
                }}
                className="button-ghost p-1.5"
                aria-label={t('commandPalette.search.clear')}
              >
                <X size={14} />
              </button>
            </Tooltip>
          )}
          <Kbd>esc</Kbd>
        </div>
        <CommandPaletteResults
          commands={filtered}
          query={query}
          selectedIndex={visibleSelectedIndex}
          listRef={listRef}
          onHoverIndex={setSelectedIndex}
        />

        <div className="surface-header flex items-center gap-4 px-4 py-3 text-[11px] text-muted">
          <span>
            <Kbd>↑↓</Kbd> {t('commandPalette.hint.navigate')}
          </span>
          <span>
            <Kbd>↵</Kbd> {t('commandPalette.hint.select')}
          </span>
          <span className="ml-auto">
            {t('commandPalette.results.count', { count: filtered.length })}
          </span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
