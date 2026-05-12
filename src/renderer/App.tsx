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
import { useAutoRun } from './hooks/useAutoRun';
import { useProjectIndexSync } from './hooks/useProjectIndexSync';
import { useProjectWatchSync } from './hooks/useProjectWatchSync';
import { useWatcherDiagnosticsSync } from './hooks/useWatcherDiagnosticsSync';
import { useAppTheme } from './hooks/useAppTheme';
import { useEffectiveTier, useEntitlement } from './hooks/useEntitlement';
import { useEditorStore } from './stores/editorStore';
import { usePluginStore } from './stores/pluginStore';
import { useSessionStore } from './stores/sessionStore';
import { useSettingsStore } from './stores/settingsStore';
import { useUIStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';
import { desktopSmokeEnabled } from './utils/desktopSmoke';
import { pushUpsellNotice } from './utils/upsellNotice';
import { trackEvent } from './utils/telemetry';

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

  // Restore session on first mount if setting is enabled.
  // RL-090 — safe mode skips session restore so a corrupted persisted
  // tab state cannot keep the renderer in a crash loop.
  useEffect(() => {
    if (hasRestoredSessionRef.current || smokeEnabled) {
      return;
    }
    hasRestoredSessionRef.current = true;

    if (isSafeMode()) {
      return;
    }

    const { restoreSession } = useSettingsStore.getState();
    if (restoreSession) {
      void useSessionStore.getState().restoreSession();
    }
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
          onReplayEntry={(entry) => replayHistoryEntry(entry, { isRunning, run })}
          onToggleVimMode={() => useSettingsStore.getState().toggleVimMode()}
        />
      )}
      {overlay === 'settings' && (
        <SettingsModal
          onClose={closeOverlay}
          onOpenWhatsNew={() => openOverlay('whats-new')}
          onStartGuidedTour={handleStartGuidedTour}
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
