import type { DeveloperUtilityId } from '../data/developerUtilities';
import {
  openHttpWorkspaceTab,
  openSqlWorkspaceTab,
} from '../runtime/openWorkspaceTab';
import { useRecipeStore } from '../stores/recipeStore';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import {
  cycleRuntimeMode,
  languageHasRuntimeModes,
} from '../../shared/runtimeModes';
import {
  cycleWorkflowMode,
  defaultWorkflowMode,
} from '../../shared/workflowMode';
import { toggleRecentRunsPopover } from '../runtime/recentRunsPopoverBridge';
import { useExecutionHistoryStore } from '../stores/executionHistoryStore';
import { useResultStore } from '../stores/resultStore';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useDependencyDetectionStore } from '../stores/dependencyDetectionStore';
import { exportCapsuleToClipboard } from '../utils/exportCapsule';
import { trackEvent } from '../utils/telemetry';
import { syncVariableInspectorSurfaceAfterToggle } from '../utils/variableInspectorSurface';
import { bucketVariableCount } from '../../shared/scopeSnapshot';
import { SHARE_LINK_TRIGGER_EVENT } from '../components/Share/shareLinkEvents';
import { type AppOverlay, useGlobalShortcuts } from './useGlobalShortcuts';

/**
 * RL-131 (AUDIT-11) — the closure-bound dependencies `AppChrome` must hand to
 * {@link useAppShortcuts}. Everything else the shortcut payload needs is reached
 * via `*.getState()` / module singletons inside the hook (unchanged from the
 * inline original), so this interface is intentionally just the values that
 * genuinely live in `AppChrome`'s render scope (runner state, the editor-store
 * callbacks bound via selectors, the overlay controls, and the project-bundle
 * exporter). Field types mirror `UseGlobalShortcutsOptions`.
 */
export interface AppShortcutDeps {
  isRunning: boolean;
  run: () => void | Promise<void>;
  stop: () => void;
  saveActiveTab: () => void | Promise<void>;
  saveActiveTabAs: () => void | Promise<void>;
  openFileFromDisk: () => void | Promise<void>;
  activeTabId: string | null;
  closeTab: (id: string) => Promise<boolean>;
  toggleSidebar: () => void;
  toggleConsole: () => void;
  overlay: AppOverlay;
  toggleOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  closeOverlay: () => void;
  openOverlay: (
    overlay: Exclude<AppOverlay, 'none'>,
    utilityId?: DeveloperUtilityId
  ) => void;
  handleOpenDeveloperUtility: (utilityId?: DeveloperUtilityId) => void;
  exportProjectBundle: () => void | Promise<void>;
}

/**
 * RL-131 (AUDIT-11) — the global keyboard-shortcut handler payload, extracted
 * verbatim from `AppChrome` in `App.tsx`. Builds the `useGlobalShortcuts`
 * options object and registers it. Handlers that already reached the stores via
 * `getState()` move in unchanged; the genuinely closure-bound values arrive
 * through {@link AppShortcutDeps} and are destructured to the same identifiers
 * the inline payload used, so the handler bodies are byte-for-byte the original.
 */
export function useAppShortcuts(deps: AppShortcutDeps): void {
  const {
    isRunning,
    run,
    stop,
    saveActiveTab,
    saveActiveTabAs,
    openFileFromDisk,
    activeTabId,
    closeTab,
    toggleSidebar,
    toggleConsole,
    overlay,
    toggleOverlay,
    closeOverlay,
    openOverlay,
    handleOpenDeveloperUtility,
    exportProjectBundle,
  } = deps;

  useGlobalShortcuts({
    isRunning,
    run,
    stop,
    saveActiveTab,
    saveActiveTabAs,
    openFileFromDisk,
    closeActiveTab: () => {
      if (activeTabId) {
        void closeTab(activeTabId);
      }
    },
    toggleSidebar,
    toggleConsole,
    overlay,
    toggleOverlay,
    openDeveloperUtilities: () => handleOpenDeveloperUtility(),
    closeOverlay,
    // RL-097 Slice 1 → MOV.02 (FASE 3) — Mod+Shift+K now opens or
    // focuses a full-screen HTTP workspace tab (the dock panel was
    // removed). No toggle-off: a full-screen tab is closed via the
    // tab strip, not by re-pressing the shortcut.
    toggleHttpWorkspace: () => {
      openHttpWorkspaceTab();
    },
    // RL-097 Slice 2 → MOV.02 (FASE 3) — Mod+Alt+S opens or focuses a
    // full-screen SQL workspace tab. Mirror of `toggleHttpWorkspace`.
    toggleSqlWorkspace: () => {
      openSqlWorkspaceTab();
    },
    // RL-099 Slice 1 fold A — Mod+Shift+G opens the Developer
    // Utilities overlay with the Pipelines panel preselected.
    openUtilityPipelines: () => {
      handleOpenDeveloperUtility('utility-pipelines');
    },
    // RL-100 Slice 1 fold A — Mod+Alt+I opens the global Import
    // overlay (cURL → HTTP request adapter Slice 1).
    openImportOverlay: () => {
      openOverlay('import-preview');
    },
    // RL-024 Slice 3 — Mod+Alt+E exports the active project as a `.zip`
    // bundle (same path as the FileTree button + palette action).
    exportProjectBundle: () => {
      void exportProjectBundle();
    },
    // RL-039 Slice B fold A — Mod+Alt+L opens the global Recipes
    // overlay. Overlay open state lives on `useRecipeStore`, not the
    // single-slot `AppOverlay` union, because a bound recipe tab can
    // co-exist with an open recipes overlay (e.g. the user wants to
    // open a second recipe in another tab while the first is still
    // active).
    openRecipesOverlay: () => {
      useRecipeStore.getState().openOverlay();
    },
    // RL-043 Slice A fold A — Mod+Alt+N creates a fresh notebook tab
    // via `useEditorStore.addNotebookTab` which also seeds the
    // companion notebookStore entry.
    openNewNotebook: () => {
      useEditorStore.getState().addNotebookTab();
    },
    cycleRuntimeMode: () => {
      // RL-019 Slice 1 fold D — cycle the active JS/TS tab through
      // the implemented runtime modes. No-op for non-JS/TS tabs.
      const state = useEditorStore.getState();
      const tab = getActiveTab(state);
      if (!tab || !languageHasRuntimeModes(tab.language)) return;
      const current = tab.runtimeMode ?? 'worker';
      const next = cycleRuntimeMode(current);
      if (next === current) return;
      state.setTabRuntimeMode(tab.id, next);
    },
    cycleWorkflowMode: () => {
      // RL-020 Slice 2 fold A — cycle the active tab's workflow
      // mode through the supported subset. Skips disabled segments
      // so a Python tab cycles Run → Scratchpad → Run, never
      // landing on Debug. No-op when there is no active tab or
      // when the supported subset has size <= 1.
      const state = useEditorStore.getState();
      const tab = getActiveTab(state);
      if (!tab) return;
      const current = tab.workflowMode ?? defaultWorkflowMode(tab.language);
      const next = cycleWorkflowMode(current, tab.language);
      if (next === current) return;
      state.setTabWorkflowMode(tab.id, next);
    },
    toggleRecentRunsPopover: () => {
      // RL-020 Slice 4 fold B — toggle the per-tab Recent Runs
      // popover. The bridge returns `false` when no pill is mounted
      // (Free tier, view-only tab, empty per-tab history); surface
      // a passive notice so the keystroke is never silent.
      const dispatched = toggleRecentRunsPopover();
      if (!dispatched) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'executionHistory.tabPill.shortcutUnavailable',
        });
      }
    },
    toggleCompareWithSnapshot: () => {
      // RL-020 Slice 8 fold D — toggle the Compare panel. Gates on
      // the comparator snapshot's language matching the active
      // tab; mirrors the toggle-button gate so the shortcut never
      // surfaces a stale diff. No-op + localized notice when the
      // gate fails.
      const editorState = useEditorStore.getState();
      const tab = getActiveTab(editorState);
      const snapshotRing = useResultStore.getState().snapshotRing;
      const snapshotIsRelevant =
        tab !== null &&
        snapshotRing.some((entry) => entry.language === tab.language);
      if (!tab || !snapshotIsRelevant) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'compare.toggle.shortcutUnavailable',
        });
        return;
      }
      const next = tab.compareWithSnapshotEnabled !== true;
      editorState.setTabCompareEnabled(tab.id, next);
      void trackEvent('runtime.compare_view_toggled', {
        language: tab.language,
        enabled: next,
      });
    },
    toggleVariableInspector: () => {
      // RL-020 Slice 9 fold C — toggle the Variables panel. Gates
      // on the scope snapshot's language matching the active tab;
      // mirrors the toggle-button gate so the shortcut never
      // surfaces a stale capture. No-op + notice when there's no
      // capture for the active language.
      const editorState = useEditorStore.getState();
      const tab = getActiveTab(editorState);
      const scopeSnapshot = useResultStore.getState().scopeSnapshot;
      const snapshotIsRelevant =
        tab !== null &&
        tab.runtimeMode !== 'node' &&
        scopeSnapshot !== null &&
        scopeSnapshot.language === tab.language;
      if (!tab || !snapshotIsRelevant) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'variableInspector.toggle.shortcutUnavailable',
        });
        return;
      }
      const next = tab.variableInspectorEnabled !== true;
      editorState.setTabVariableInspectorEnabled(tab.id, next);
      syncVariableInspectorSurfaceAfterToggle(next);
      const bucket = scopeSnapshot
        ? bucketVariableCount(scopeSnapshot.variables.length)
        : '0';
      void trackEvent('runtime.variable_inspector_opened', {
        language: tab.language,
        variableCount: bucket,
      });
    },
    toggleStdinPanel: () => {
      // RL-093 Slice 3 — open or close the bottom Stdin drawer for the
      // active tab. Gates on language (JS / TS / Python only), runtime
      // mode (no Browser preview), and the `showStdinPanel` user
      // setting. The state shape mirrors the panel chip click handler
      // in AppLayout.PanelChipsRow so keystroke and click stay in sync.
      const editorState = useEditorStore.getState();
      const tab = getActiveTab(editorState);
      const settings = useSettingsStore.getState();
      const uiState = useUIStore.getState();
      const stdinAvailable =
        !!tab &&
        settings.showStdinPanel &&
        tab.runtimeMode !== 'browser-preview' &&
        (tab.language === 'javascript' ||
          tab.language === 'typescript' ||
          tab.language === 'python');
      if (!stdinAvailable) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'panelChips.stdin.disabled',
        });
        return;
      }
      if (
        uiState.activeBottomPanel === 'stdin' &&
        uiState.consoleVisible
      ) {
        uiState.setConsoleVisible(false);
      } else {
        uiState.openBottomPanel('stdin');
      }
    },
    resetFloatingPositions: () => {
      // RL-093 Slice 3 — clear both persisted floating positions back
      // to the synchronous defaults. Useful when a localStorage value
      // landed off-screen after a monitor / window-size change.
      useUIStore.getState().resetFloatingPositions();
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'actionPill.resetFloatingNotice',
      });
    },
    toggleVariableInspectorSurface: () => {
      // RL-093 Slice 3 fold D — flip floating ↔ bottom. Sticks via
      // settingsStore persist; user sees the chip + card reorder
      // immediately.
      const settings = useSettingsStore.getState();
      const next =
        settings.variableInspectorSurface === 'floating' ? 'bottom' : 'floating';
      settings.setVariableInspectorSurface(next);
      const editorState = useEditorStore.getState();
      const tab = getActiveTab(editorState);
      const scopeSnapshot = useResultStore.getState().scopeSnapshot;
      const uiState = useUIStore.getState();
      const canShowBottomVariables =
        next === 'bottom' &&
        tab?.variableInspectorEnabled === true &&
        tab.runtimeMode !== 'node' &&
        scopeSnapshot !== null &&
        scopeSnapshot.language === tab.language;
      if (canShowBottomVariables) {
        uiState.openBottomPanel('variables');
      } else if (next === 'floating' && uiState.activeBottomPanel === 'variables') {
        uiState.setConsoleVisible(false);
      }
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey:
          next === 'floating'
            ? 'variableInspector.surface.notice.toFloating'
            : 'variableInspector.surface.notice.toBottom',
      });
    },
    // RL-094 Slice 1.5 fold A — keyboard shortcut for the primary
    // result-panel export surface. Reads the latest capsule, calls
    // the shared helper (`exportCapsuleToClipboard`), pushes the
    // matching status notice. Surfaces a `noCapsule` notice when
    // there's no run to export rather than silently dropping.
    exportLatestCapsule: () => {
      const capsule = useExecutionHistoryStore.getState().latestCapsule();
      if (!capsule) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'results.actions.exportCapsule.noCapsule',
        });
        return;
      }
      void exportCapsuleToClipboard(capsule, 'result-panel-export').then(
        (result) => {
          useUIStore.getState().pushStatusNotice(
            result.ok
              ? {
                  tone: 'success',
                  messageKey: 'settings.account.runCapsules.copiedNotice',
                }
              : {
                  tone: 'warning',
                  messageKey:
                    'results.actions.exportCapsule.clipboardUnavailable',
                }
          );
        }
      );
    },
    // RL-036 Phase A1 fold D — keyboard shortcut for the share-link
    // copy. Dispatches the same `lingua-share-link-trigger` event the
    // command palette uses (fold C) so the always-mounted
    // `<ShareLinkController>` owns shortcut-triggered confirmation
    // even when the result panel is hidden. Telemetry tags
    // `trigger: 'shortcut'`.
    copyShareLink: () => {
      window.dispatchEvent(
        new CustomEvent(SHARE_LINK_TRIGGER_EVENT, {
          detail: { trigger: 'shortcut' },
        })
      );
    },
    // RL-101 Slice 1 fold D — `Mod+Shift+W` resets all three onboarding
    // stages so the welcome scratchpad re-seeds on next eligible mount
    // and both toasts re-arm. Surfaces an explicit notice so the user
    // knows the shortcut fired (otherwise the reset would be silent
    // until the next run / save).
    replayOnboarding: () => {
      const settings = useSettingsStore.getState();
      settings.resetOnboardingWelcome();
      settings.resetOnboardingFirstRun();
      settings.resetOnboardingFirstSnippet();
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'onboarding.notice.welcomeReplay',
      });
    },
    // RL-025 Slice A fold C — `Mod+Shift+J` focuses the Dependencies
    // bottom-panel tab when there are detected dependencies for the
    // active file. When the tab is hidden (count == 0 or master
    // toggle OFF) we surface a localized notice so the shortcut
    // never feels broken — the user gets a hint that detection has
    // either nothing to show OR is disabled.
    showDependenciesPanel: () => {
      const activeTab = getActiveTab(useEditorStore.getState());
      const entry = activeTab
        ? useDependencyDetectionStore.getState().byTab.get(activeTab.id)
        : null;
      const currentEntry =
        entry?.language === activeTab?.language ? entry : null;
      const enabled = useSettingsStore.getState().dependencyDetectionEnabled;
      if (!enabled) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'dependencies.shortcut.disabled',
        });
        return;
      }
      if (
        !currentEntry ||
        (currentEntry.dependencies.length === 0 && !currentEntry.skippedReason)
      ) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'dependencies.shortcut.empty',
        });
        return;
      }
      useUIStore.getState().openBottomPanel('dependencies');
    },
  });
}
