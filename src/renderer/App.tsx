import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from './components/Layout';
import { GuidedTourProvider } from './components/GuidedTour/GuidedTourProvider';
import { useGuidedTour } from './components/GuidedTour/guidedTourContext';
import { SettingsModal } from './components/Settings/SettingsModal';
import { WhatsNewSection } from './components/Settings/WhatsNewSection';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { replayHistoryEntry } from './utils/replayHistoryEntry';
import { GoToSymbol } from './components/GoToSymbol/GoToSymbol';
import { ProjectSearch } from './components/ProjectSearch/ProjectSearch';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { KeyboardShortcutsModal } from './components/KeyboardShortcuts/KeyboardShortcutsModal';
import { SnippetsModal } from './components/Snippets';
import { FirstRunConsentModal } from './components/FirstRunConsentModal';
import { NativeExecutionWarning } from './components/NativeExecutionWarning/NativeExecutionWarning';
import { StatusNoticeBanner } from './components/StatusNotice/StatusNoticeBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isFactoryMode, isSafeMode } from './utils/safeBoot';
import { WebUpdateBanner } from './components/WebUpdateBanner';
import { CHANGELOG_ENTRIES } from './data/changelog';
import {
  DEFAULT_DEVELOPER_UTILITY_ID,
  type DeveloperUtilityId,
} from './data/developerUtilities';
import { getActiveAppLanguage } from './i18n';
import { useAppInfo } from './hooks/useAppInfo';
import { useRunner } from './hooks/useRunner';
import { useDesktopSmoke } from './hooks/useDesktopSmoke';
import type { AppOverlay } from './hooks/useGlobalShortcuts';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useGoLspLifecycle } from './hooks/useGoLspLifecycle';
import { useRustLspLifecycle } from './hooks/useRustLspLifecycle';
import { useDeepLinks } from './hooks/useDeepLinks';
import { useDownloadedUpdateNotice } from './hooks/useDownloadedUpdateNotice';
import { useDefaultOpenFileConsumer } from './hooks/useDefaultOpenFileConsumer';
import { useShareLinkBoot } from './hooks/useShareLinkBoot';
import { ShareLinkController } from './components/Share/ShareLinkButton';
import { SHARE_LINK_TRIGGER_EVENT } from './components/Share/shareLinkEvents';
import { useAutoRun } from './hooks/useAutoRun';
import { useProjectIndexSync } from './hooks/useProjectIndexSync';
import { useProjectWatchSync } from './hooks/useProjectWatchSync';
import { useWatcherDiagnosticsSync } from './hooks/useWatcherDiagnosticsSync';
import { useAppTheme } from './hooks/useAppTheme';
import { useEffectiveTier, useEntitlement } from './hooks/useEntitlement';
import { useEditorStore } from './stores/editorStore';
import { useExecutionHistoryStore } from './stores/executionHistoryStore';
import { useResultStore } from './stores/resultStore';
import { exportCapsuleToClipboard } from './utils/exportCapsule';
import {
  cycleRuntimeMode,
  languageHasRuntimeModes,
} from '../shared/runtimeModes';
import {
  cycleWorkflowMode,
  defaultWorkflowMode,
} from '../shared/workflowMode';
import { toggleRecentRunsPopover } from './runtime/recentRunsPopoverBridge';
import { usePluginStore } from './stores/pluginStore';
import { useSessionStore } from './stores/sessionStore';
import { useSettingsStore } from './stores/settingsStore';
import { useUIStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';
import { desktopSmokeEnabled } from './utils/desktopSmoke';
import { pushUpsellNotice } from './utils/upsellNotice';
import { trackEvent } from './utils/telemetry';
import { syncVariableInspectorSurfaceAfterToggle } from './utils/variableInspectorSurface';
import { bucketVariableCount } from '../shared/scopeSnapshot';

const DeveloperUtilitiesModal = lazy(async () => {
  const module = await import('./components/DeveloperUtilities');
  return { default: module.DeveloperUtilitiesModal };
});

function FactoryRecoveryNotice() {
  const { t } = useTranslation();
  const [visible] = useState(() => isFactoryMode());

  if (!visible) return null;

  return (
    <aside
      role="status"
      data-testid="factory-recovery-notice"
      className="fixed left-1/2 top-4 z-[70] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[1rem] border border-warning/60 bg-background-elevated px-4 py-3 shadow-2xl shadow-black/30"
    >
      <p className="text-sm font-semibold text-foreground">
        {t('recovery.factoryNotice.title')}
      </p>
      <p className="mt-1 text-sm leading-6 text-muted">
        {t('recovery.factoryNotice.body')}
      </p>
    </aside>
  );
}

function AppChrome({
  overlay,
  openOverlay,
  toggleOverlay,
  closeOverlay,
  selectedUtilityId,
}: {
  overlay: AppOverlay;
  openOverlay: (
    overlay: Exclude<AppOverlay, 'none'>,
    utilityId?: DeveloperUtilityId
  ) => void;
  toggleOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  closeOverlay: () => void;
  selectedUtilityId: DeveloperUtilityId;
}) {
  const { run, stop, isRunning } = useRunner();
  const { t } = useTranslation();
  const saveActiveTab = useEditorStore((s) => s.saveActiveTab);
  const saveActiveTabAs = useEditorStore((s) => s.saveActiveTabAs);
  const openFileFromDisk = useEditorStore((s) => s.openFileFromDisk);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const lastSeenVersion = useSettingsStore((s) => s.lastSeenVersion);
  const setLastSeenVersion = useSettingsStore((s) => s.setLastSeenVersion);
  const suppressTourAutoStart = useSettingsStore((s) => s.suppressTourAutoStart);
  const { toggleSidebar, toggleConsole } = useUIStore();
  const initializePlugins = usePluginStore((s) => s.initialize);
  const initializeUpdates = useUpdateStore((s) => s.initialize);
  const appInfo = useAppInfo();
  const effectiveTier = useEffectiveTier();
  const canUseDeveloperUtilities = useEntitlement('DEV_UTILITIES');
  // RL-026 Slice 3 — rust-analyzer lifecycle.
  // RL-026 Slice 4 — gopls lifecycle. Same hook shape via the shared
  // `useLspLifecycle`; the two languages have independent stores so a
  // crash in one does not block the other.
  useRustLspLifecycle();
  useGoLspLifecycle();
  const { hasCompletedTour, startTour } = useGuidedTour();
  const smokeEnabled = desktopSmokeEnabled();
  const hasHandledDeepLink = useDeepLinks({ openOverlay });
  const hasRestoredSessionRef = useRef(false);
  const hasHandledWhatsNewRef = useRef(false);
  const hasHandledAutoTourRef = useRef(false);
  const [sessionRestoreReady, setSessionRestoreReady] = useState(false);

  // Restore session on first mount if setting is enabled.
  // RL-090 — safe mode skips session restore so a corrupted persisted
  // tab state cannot keep the renderer in a crash loop.
  useEffect(() => {
    let cancelled = false;

    const finish = () => {
      if (!cancelled) {
        setSessionRestoreReady(true);
      }
    };

    if (hasRestoredSessionRef.current || smokeEnabled) {
      finish();
      return;
    }
    hasRestoredSessionRef.current = true;

    if (isSafeMode()) {
      finish();
      return;
    }

    const { restoreSession } = useSettingsStore.getState();
    void (async () => {
      if (restoreSession) {
        await useSessionStore.getState().restoreSession();
      }
      finish();
    })();

    return () => {
      cancelled = true;
    };
  }, [smokeEnabled]);

  // Auto-save session when tabs change (debounced)
  useEffect(() => {
    if (smokeEnabled) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout>;
    const unsubscribe = useEditorStore.subscribe(() => {
      const { restoreSession } = useSettingsStore.getState();
      if (!restoreSession) {
        return;
      }

      clearTimeout(timeout);
      timeout = setTimeout(() => {
        useSessionStore.getState().saveSession();
      }, 1000);
    });

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [smokeEnabled]);

  useEffect(() => {
    // RL-090 — safe mode skips plugin discovery so a broken plugin
    // manifest cannot keep the renderer in a crash loop. The user
    // can re-enable plugins by reloading without `?safe-mode=1`.
    if (isSafeMode()) return;
    void initializePlugins();
  }, [initializePlugins]);

  useEffect(() => {
    void initializeUpdates();
  }, [initializeUpdates]);

  // Surface a renderer-side toast when the autoupdater hands us a
  // downloaded release. Lives next to `initializeUpdates` so it shares
  // the same App-mount scope and runs independently of whether the
  // user opens Settings → Updates.
  useDownloadedUpdateNotice();
  // RL-044 Slice 2b-β-α Fold H — default consumer for the
  // `lingua-open-file` CustomEvent dispatched by <RichValueError>
  // when users click a stack frame. Until RL-024 multi-file workspace
  // ships the real open-in-editor handler, this hook shows a
  // status-notice fallback so clicks get visible feedback.
  useDefaultOpenFileConsumer();

  // RL-036 Phase A1 — hash-fragment share-link importer. Runs once
  // at mount + listens for `hashchange` so a user can paste a new
  // share link into the address bar without reloading. Skips in
  // safe mode so a poisoned link cannot trap a crash recovery cycle.
  useShareLinkBoot({ enabled: sessionRestoreReady });

  useEffect(() => {
    // RL-065: fire the first telemetry event. `trackEvent` is a no-op
    // unless the user has explicitly opted in, the endpoint is
    // configured, and the kill switch is not set. Safe to call
    // unconditionally here.
    void trackEvent('app.launched', {
      platform: window.lingua?.platform ?? 'unknown',
    });
  }, []);

  useEffect(() => {
    if (hasHandledWhatsNewRef.current || smokeEnabled || hasHandledDeepLink) {
      return;
    }

    const currentVersion = appInfo?.version;
    if (!currentVersion) {
      return;
    }

    if (lastSeenVersion === currentVersion) {
      hasHandledWhatsNewRef.current = true;
      return;
    }

    if (overlay !== 'none') {
      return;
    }

    hasHandledWhatsNewRef.current = true;
    setLastSeenVersion(currentVersion);
    openOverlay('whats-new');
  }, [
    appInfo?.version,
    hasHandledDeepLink,
    lastSeenVersion,
    openOverlay,
    overlay,
    setLastSeenVersion,
    smokeEnabled,
  ]);

  useEffect(() => {
    if (hasHandledAutoTourRef.current || smokeEnabled || hasHandledDeepLink) {
      return;
    }

    if (!appInfo?.version) {
      return;
    }

    if (suppressTourAutoStart) {
      hasHandledAutoTourRef.current = true;
      return;
    }

    if (overlay !== 'none' || hasCompletedTour) {
      return;
    }

    hasHandledAutoTourRef.current = true;
    const timeout = window.setTimeout(() => {
      startTour();
    }, 260);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    appInfo?.version,
    hasCompletedTour,
    suppressTourAutoStart,
    hasHandledDeepLink,
    overlay,
    startTour,
    smokeEnabled,
  ]);

  // Auto-run code after the configured idle debounce
  useAutoRun();
  useProjectWatchSync();
  useProjectIndexSync();
  useWatcherDiagnosticsSync();
  useAppTheme();
  useDesktopSmoke(smokeEnabled);

  // Dirty-close handler: check for unsaved tabs before app close
  useEffect(() => {
    if (!window.lingua?.onBeforeClose) {
      return;
    }

    return window.lingua.onBeforeClose(() => {
      const { tabs } = useEditorStore.getState();
      const dirtyTabs = tabs.filter((tab) => tab.isDirty);

      if (dirtyTabs.length === 0) {
        window.lingua.forceClose();
        return;
      }

      void (async () => {
        const response = await window.lingua.confirmClose(
          dirtyTabs.map((tab) => tab.name),
          getActiveAppLanguage()
        );

        if (response === 0) {
          for (const tab of dirtyTabs) {
            const saved = await useEditorStore.getState().saveTabById(tab.id);
            if (!saved) {
              return;
            }
          }

          window.lingua.forceClose();
        } else if (response === 1) {
          window.lingua.forceClose();
        }
      })();
    });
  }, []);

  const handleOpenDeveloperUtility = (utilityId?: DeveloperUtilityId) => {
    if (canUseDeveloperUtilities) {
      openOverlay('utilities', utilityId);
      return;
    }
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: t('upsell.feature.devUtilities'),
    });
    void trackEvent('feature.blocked', {
      entitlement: 'dev-utilities',
      tier: effectiveTier,
    });
  };

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
    cycleRuntimeMode: () => {
      // RL-019 Slice 1 fold D — cycle the active JS/TS tab through
      // the implemented runtime modes. No-op for non-JS/TS tabs.
      const state = useEditorStore.getState();
      const tab = state.tabs.find((t) => t.id === state.activeTabId);
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
      const tab = state.tabs.find((t) => t.id === state.activeTabId);
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
      const tab = editorState.tabs.find(
        (item) => item.id === editorState.activeTabId
      );
      const snapshotRing = useResultStore.getState().snapshotRing;
      const snapshotIsRelevant =
        tab !== undefined &&
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
      const tab = editorState.tabs.find(
        (item) => item.id === editorState.activeTabId
      );
      const scopeSnapshot = useResultStore.getState().scopeSnapshot;
      const snapshotIsRelevant =
        tab !== undefined &&
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
      const tab = editorState.tabs.find(
        (item) => item.id === editorState.activeTabId
      );
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
      const tab = editorState.tabs.find(
        (item) => item.id === editorState.activeTabId
      );
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
  });

  const handleStartGuidedTour = () => {
    closeOverlay();
    startTour();
  };

  // RL-061 Slice 5 — surface the web-build update banner at the top
  // of the chrome. Browser builds expose `window.lingua` through
  // src/web/adapter.ts, so gate on the explicit platform instead of
  // bridge presence.
  const showWebUpdateBanner = typeof window !== 'undefined' && window.lingua?.platform === 'web';

  return (
    <>
      {showWebUpdateBanner ? <WebUpdateBanner /> : null}
      <AppLayout
        onOpenSettings={() => openOverlay('settings')}
        onOpenPalette={() => openOverlay('palette')}
        onOpenQuickOpen={() => openOverlay('quick-open')}
        onOpenSnippets={() => openOverlay('snippets')}
        onOpenUtilities={() => handleOpenDeveloperUtility()}
        utilitiesOpen={overlay === 'utilities'}
      />
      <ShareLinkController />
      {overlay === 'quick-open' && <QuickOpen onClose={closeOverlay} />}
      {overlay === 'search' && <ProjectSearch onClose={closeOverlay} />}
      {overlay === 'go-to-symbol' && <GoToSymbol onClose={closeOverlay} />}
      {overlay === 'palette' && (
        <CommandPalette
          onClose={closeOverlay}
          onOpenSettings={() => openOverlay('settings')}
          onOpenWhatsNew={() => openOverlay('whats-new')}
          onStartGuidedTour={handleStartGuidedTour}
          onOpenSnippets={() => openOverlay('snippets')}
          onOpenProjectSearch={() => openOverlay('search')}
          onOpenGoToSymbol={() => openOverlay('go-to-symbol')}
          onOpenDeveloperUtility={(utilityId) => handleOpenDeveloperUtility(utilityId)}
          onOpenKeyboardShortcuts={() => openOverlay('keyboard-shortcuts')}
          onRerunLast={() => void run()}
          onReplayEntry={(entry) => {
            // Gate telemetry on the actual replay dispatch so a refused
            // call (already-running, no-snapshot, open-failed) does
            // not inflate adoption counts. Same pattern in the pill +
            // popover surfaces; centralizing here would require an
            // extra closure layer for marginal gain.
            const dispatched = replayHistoryEntry(entry, { isRunning, run });
            if (dispatched) {
              void trackEvent('runtime.history_replay', {
                language: entry.language,
                status: entry.status,
                surface: 'palette',
              });
            }
          }}
          onToggleVimMode={() => useSettingsStore.getState().toggleVimMode()}
        />
      )}
      {overlay === 'settings' && (
        <SettingsModal
          onClose={closeOverlay}
          onOpenWhatsNew={() => openOverlay('whats-new')}
          onStartGuidedTour={handleStartGuidedTour}
          onOpenKeyboardShortcuts={() => openOverlay('keyboard-shortcuts')}
        />
      )}
      {overlay === 'whats-new' && (
        <WhatsNewSection entries={CHANGELOG_ENTRIES} onClose={closeOverlay} />
      )}
      {overlay === 'snippets' && <SnippetsModal onClose={closeOverlay} />}
      {overlay === 'utilities' && (
        <Suspense fallback={null}>
          <DeveloperUtilitiesModal
            onClose={closeOverlay}
            initialUtilityId={selectedUtilityId}
          />
        </Suspense>
      )}
      {overlay === 'keyboard-shortcuts' && (
        <KeyboardShortcutsModal onClose={closeOverlay} />
      )}
      <FactoryRecoveryNotice />
      <StatusNoticeBanner />
      <FirstRunConsentModal />
      <NativeExecutionWarning />
    </>
  );
}

export function App() {
  const [overlay, setOverlay] = useState<AppOverlay>('none');
  const [selectedUtilityId, setSelectedUtilityId] = useState<DeveloperUtilityId>(
    DEFAULT_DEVELOPER_UTILITY_ID
  );

  const openOverlay = (
    nextOverlay: Exclude<AppOverlay, 'none'>,
    utilityId?: DeveloperUtilityId
  ) => {
    if (nextOverlay === 'utilities') {
      setSelectedUtilityId(utilityId ?? DEFAULT_DEVELOPER_UTILITY_ID);
    }
    setOverlay(nextOverlay);
    // RL-065 — fire overlay.opened so a consenting user's telemetry can
    // reflect which panels got use. trackEvent is a no-op unless consent
    // is granted and the endpoint + kill-switch let it through; the
    // allowlist already includes overlay.opened with an overlayId string
    // property, so no allowlist churn here.
    void trackEvent('overlay.opened', { overlayId: nextOverlay });
  };

  const toggleOverlay = (nextOverlay: Exclude<AppOverlay, 'none'>) => {
    setOverlay((currentOverlay) => {
      const next = currentOverlay === nextOverlay ? 'none' : nextOverlay;
      if (next !== 'none') {
        void trackEvent('overlay.opened', { overlayId: next });
      }
      return next;
    });
  };

  const closeOverlay = () => {
    setOverlay('none');
  };

  return (
    <ErrorBoundary region="shell">
      <GuidedTourProvider
        controls={{
          closeOverlay,
          openPalette: () => openOverlay('palette'),
          openSnippets: () => openOverlay('snippets'),
        }}
      >
        <AppChrome
          overlay={overlay}
          openOverlay={openOverlay}
          toggleOverlay={toggleOverlay}
          closeOverlay={closeOverlay}
          selectedUtilityId={selectedUtilityId}
        />
      </GuidedTourProvider>
    </ErrorBoundary>
  );
}
