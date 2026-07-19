import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from './components/Layout';
import { AppOverlays } from './components/AppOverlays';
import { AiExplainCodeHost } from './components/AI/AiExplainCodeHost';
import { GuidedTourProvider } from './components/GuidedTour/GuidedTourProvider';
import { useGuidedTour } from './components/GuidedTour/guidedTourContext';
import { useProjectBundle } from './hooks/useProjectBundle';
import { claimCapsuleListSurface } from './components/CapsuleList/capsuleListSurface';
import { useRecipeStore } from './stores/recipeStore';
import { FirstRunConsentModal } from './components/FirstRunConsentModal';
import { NativeExecutionWarning } from './components/NativeExecutionWarning/NativeExecutionWarning';
import { StatusNoticeBanner } from './components/StatusNotice/StatusNoticeBanner';
import { LiveAnnouncer } from './components/a11y/LiveAnnouncer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isFactoryMode, isSafeMode } from './utils/safeBoot';
import { WebUpdateBanner } from './components/WebUpdateBanner';
import { findDeveloperUtility, type DeveloperUtilityId } from './data/developerUtilities';
import { getActiveAppLanguage } from './i18n';
import { useAppInfo } from './hooks/useAppInfo';
import { useRunner } from './hooks/useRunner';
import { useDesktopSmoke } from './hooks/useDesktopSmoke';
import type { AppOverlay } from './hooks/useGlobalShortcuts';
import { useAppShortcuts } from './hooks/useAppShortcuts';
import { useSessionAutoSave } from './hooks/useSessionAutoSave';
import { useSessionRestoreBoot } from './hooks/useSessionRestoreBoot';
import { useGoLspLifecycle } from './hooks/useGoLspLifecycle';
import { useRustLspLifecycle } from './hooks/useRustLspLifecycle';
import { useDeepLinks } from './hooks/useDeepLinks';
import { useDownloadedUpdateNotice } from './hooks/useDownloadedUpdateNotice';
import { useWhatsNewNotice } from './hooks/useWhatsNewNotice';
import { useDefaultOpenFileConsumer } from './hooks/useDefaultOpenFileConsumer';
import { useShareLinkBoot } from './hooks/useShareLinkBoot';
import { ShareLinkController } from './components/Share/ShareLinkButton';
import { useOnboardingChoreography } from './hooks/useOnboardingChoreography';
import { useRunLedgerTap } from './hooks/useRunLedgerTap';
import { useDependencyDetection } from './hooks/useDependencyDetection';
import { useGitDetectOnProjectChange } from './hooks/useGitDetectOnProjectChange';
import { useGitStatus } from './hooks/useGitStatus';
import { useAutoRun } from './hooks/useAutoRun';
import { useProjectIndexSync } from './hooks/useProjectIndexSync';
import { useProjectWatchSync } from './hooks/useProjectWatchSync';
import { useWatcherDiagnosticsSync } from './hooks/useWatcherDiagnosticsSync';
import { useAppTheme } from './hooks/useAppTheme';
import { useBootCompletionMarkers } from './hooks/useBootCompletionMarkers';
import { useLicenseSettingsNavigation } from './hooks/useLicenseSettingsNavigation';
import { useCommandListener } from './hooks/useCommandListener';
import { useEffectiveTier, useEntitlement } from './hooks/useEntitlement';
import { useTelemetry } from './hooks/useTelemetry';
import { getActiveTab, useEditorStore } from './stores/editorStore';
import { openUtilitiesWorkspaceTab } from './runtime/openWorkspaceTab';
import { usePluginStore } from './stores/pluginStore';
import { useSettingsStore } from './stores/settingsStore';
import { useUIStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';
import { desktopSmokeEnabled } from './utils/desktopSmoke';
import { pushUpsellNotice } from './utils/upsellNotice';

function FactoryRecoveryNotice() {
  const { t } = useTranslation();
  const [visible] = useState(() => isFactoryMode());

  if (!visible) return null;

  return (
    <aside
      role="status"
      data-testid="factory-recovery-notice"
      className="fixed left-1/2 top-4 z-[70] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-warning/60 bg-background-elevated px-4 py-3 shadow-2xl shadow-black/30"
    >
      <p className="text-body font-semibold text-foreground">{t('recovery.factoryNotice.title')}</p>
      <p className="mt-1 text-body leading-6 text-muted">{t('recovery.factoryNotice.body')}</p>
    </aside>
  );
}

function AppChrome({
  overlay,
  openOverlay,
  toggleOverlay,
  closeOverlay,
}: {
  overlay: AppOverlay;
  openOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  toggleOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  closeOverlay: () => void;
}) {
  const { run, stop, isRunning } = useRunner();
  const { t } = useTranslation();
  const { track } = useTelemetry();
  const saveActiveTab = useEditorStore(s => s.saveActiveTab);
  const saveActiveTabAs = useEditorStore(s => s.saveActiveTabAs);
  const openFileFromDisk = useEditorStore(s => s.openFileFromDisk);
  const closeTab = useEditorStore(s => s.closeTab);
  const activeTabId = useEditorStore(s => s.activeTabId);
  const utilitiesWorkspaceActive = useEditorStore(s => {
    return getActiveTab(s)?.kind === 'utilities';
  });
  const suppressTourAutoStart = useSettingsStore(s => s.suppressTourAutoStart);
  // Select the two stable actions individually — `useUIStore()` with no
  // selector re-renders AppChrome (the entire shell) on EVERY ui-store
  // write, including each of the ~134 statusNotice push/dismiss sites.
  const toggleSidebar = useUIStore(s => s.toggleSidebar);
  const toggleConsole = useUIStore(s => s.toggleConsole);
  const initializePlugins = usePluginStore(s => s.initialize);
  const initializeUpdates = useUpdateStore(s => s.initialize);
  const appInfo = useAppInfo();
  const effectiveTier = useEffectiveTier();
  const canUseUtilityWorkflows = useEntitlement('DEV_UTILITIES');
  // RL-026 Slice 3 — rust-analyzer lifecycle.
  // RL-026 Slice 4 — gopls lifecycle. Same hook shape via the shared
  // `useLspLifecycle`; the two languages have independent stores so a
  // crash in one does not block the other.
  useRustLspLifecycle();
  useGoLspLifecycle();
  const { hasCompletedTour, startTour } = useGuidedTour();
  const smokeEnabled = desktopSmokeEnabled();
  const hasHandledDeepLink = useDeepLinks({ openOverlay });
  // RL-024 Slice 3 — project zip bundle export/import choreography,
  // shared by the FileTree button, the Mod+Alt+E shortcut, and the
  // command-palette actions.
  const { exportProjectBundle } = useProjectBundle();
  const hasHandledAutoTourRef = useRef(false);
  // RL-111 — boot-time session restore (extracted to a hook to keep App.tsx
  // under the AUDIT-11 size budget). Owns the `always`/`ask`/`never` decision
  // and the `ask`-mode restore prompt; returns the boot-gating ready flag.
  const sessionRestoreReady = useSessionRestoreBoot(smokeEnabled);
  useBootCompletionMarkers(sessionRestoreReady);

  // RL-147 — debounced session auto-save, narrowed to save-relevant
  // editor-store changes (see useSessionAutoSave for the contract).
  useSessionAutoSave(smokeEnabled);

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
  useWhatsNewNotice({
    currentVersion: appInfo?.version,
    hasHandledDeepLink,
    overlay,
    openOverlay,
    suppressed: smokeEnabled,
  });
  // RL-044 Slice 2b-β-α Fold H — default consumer for the
  // `file.open` command emitted by <RichValueError>
  // when users click a stack frame. Until RL-024 multi-file workspace
  // ships the real open-in-editor handler, this hook shows a
  // status-notice fallback so clicks get visible feedback.
  useDefaultOpenFileConsumer();

  // RL-036 Phase A1 — hash-fragment share-link importer. Runs once
  // at mount + listens for `hashchange` so a user can paste a new
  // share link into the address bar without reloading. Skips in
  // safe mode so a poisoned link cannot trap a crash recovery cycle.
  useShareLinkBoot({ enabled: sessionRestoreReady });
  // RL-101 Slice 1 — onboarding choreography. Seeds the welcome
  // scratchpad on fresh installs + subscribes to execution-history
  // and snippets stores so the first successful run and first
  // snippet save fire single-CTA toasts. Gated on
  // `sessionRestoreReady` so a real restored session always wins
  // over the seed; safe mode short-circuits the hook entirely.
  useOnboardingChoreography({ enabled: sessionRestoreReady });
  // IT2-C1 — Run Ledger tap: forwards each NEW execution-history entry
  // (manual runs only — auto-runs never reach that store) into the
  // opt-in lingua_ledger DuckDB schema, fire-and-forget. The hook
  // subscribes unconditionally; recordRun itself is the opt-in gate.
  useRunLedgerTap();
  // RL-102 Slice 1 — Git read-only layer. The detect hook resolves
  // posture on every project root change; the status hook drives
  // per-file pill updates via the existing fs watcher. Both
  // self-gate on the `window.lingua.git` bridge being present
  // (desktop only); per-file `// @git-ignore-status` remains the
  // user-facing opt-out.
  useGitDetectOnProjectChange();
  useGitStatus();

  useEffect(() => {
    // RL-065: fire the first telemetry event. `track` is a no-op
    // unless the user has explicitly opted in, the endpoint is
    // configured, and the kill switch is not set. Safe to call
    // unconditionally here.
    track('app.launched', {
      platform: window.lingua?.platform ?? 'unknown',
    });
  }, [track]);

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
      const dirtyTabs = tabs.filter(tab => tab.isDirty);

      if (dirtyTabs.length === 0) {
        window.lingua.forceClose();
        return;
      }

      void (async () => {
        const response = await window.lingua.confirmClose(
          dirtyTabs.map(tab => tab.name),
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
    const requestedUtility = utilityId ? findDeveloperUtility(utilityId) : null;
    if (requestedUtility?.requiresEntitlement && !canUseUtilityWorkflows) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: t('upsell.feature.utilityWorkflows'),
      });
      track('feature.blocked', {
        entitlement: 'utility-workflows',
        tier: effectiveTier,
      });
      return;
    }
    openUtilitiesWorkspaceTab(utilityId);
    closeOverlay();
    // Preserve the pre-workspace adoption signal: the telemetry enum still
    // names the event `overlay.opened`, but the surface id remains stable
    // so dashboards do not lose Utilities open counts during MOV.03.
    track('overlay.opened', { overlayId: 'utilities' });
  };

  useAppShortcuts({
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
  });

  // RL-101 / RL-135 — keep overlay ownership in App while shared
  // producers request the snippets surface through the typed bus.
  useCommandListener('overlay.openSnippets', () => openOverlay('snippets'));

  useLicenseSettingsNavigation(() => openOverlay('settings'));

  // RL-094 / RL-135 — Settings and paste importers request the
  // capsule-import overlay without reaching into App state.
  useCommandListener('capsule.openImport', () => openOverlay('capsule-import'));

  // RL-094 / RL-135 — claim the typed originating surface for
  // capsule.browse_opened telemetry, then open the owned overlay.
  useCommandListener('capsule.openList', ({ surface }) => {
    claimCapsuleListSurface(surface);
    openOverlay('capsule-list');
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
      <KeystrokeReactiveHooks />
      {showWebUpdateBanner ? <WebUpdateBanner /> : null}
      <AppLayout
        onOpenSettings={() => openOverlay('settings')}
        onOpenPalette={() => openOverlay('palette')}
        onOpenQuickOpen={() => openOverlay('quick-open')}
        onOpenSnippets={() => openOverlay('snippets')}
        onOpenUtilities={() => handleOpenDeveloperUtility()}
        onOpenRecipes={() => useRecipeStore.getState().openOverlay()}
        utilitiesOpen={utilitiesWorkspaceActive}
      />
      <ShareLinkController />
      <AppOverlays
        overlay={overlay}
        openOverlay={openOverlay}
        closeOverlay={closeOverlay}
        onStartGuidedTour={handleStartGuidedTour}
        onOpenDeveloperUtility={handleOpenDeveloperUtility}
        run={run}
        isRunning={isRunning}
        exportProjectBundle={exportProjectBundle}
      />
      <FactoryRecoveryNotice />
      <StatusNoticeBanner />
      <LiveAnnouncer />
      <FirstRunConsentModal />
      <NativeExecutionWarning />
      <AiExplainCodeHost />
    </>
  );
}

/**
 * Hosts the hooks that must react to every keystroke: the auto-run
 * debounce (RL-020) and per-tab dependency detection (RL-025 Slice A).
 * Both subscribe to the active tab's content, so their host re-renders
 * on every keypress BY DESIGN — isolating them in a null-rendering leaf
 * keeps that churn out of AppChrome, whose re-render would otherwise
 * reconcile the entire shell (AppLayout, toolbar, file tree, status bar)
 * per keystroke.
 */
function KeystrokeReactiveHooks() {
  useAutoRun();
  useDependencyDetection();
  return null;
}

export function App() {
  const [overlay, setOverlay] = useState<AppOverlay>('none');
  const { track } = useTelemetry();

  const openOverlay = (nextOverlay: Exclude<AppOverlay, 'none'>) => {
    setOverlay(nextOverlay);
    // RL-065 — fire overlay.opened so a consenting user's telemetry can
    // reflect which panels got use. track is a no-op unless consent
    // is granted and the endpoint + kill-switch let it through; the
    // allowlist already includes overlay.opened with an overlayId string
    // property, so no allowlist churn here.
    track('overlay.opened', { overlayId: nextOverlay });
  };

  const toggleOverlay = (nextOverlay: Exclude<AppOverlay, 'none'>) => {
    setOverlay(currentOverlay => {
      const next = currentOverlay === nextOverlay ? 'none' : nextOverlay;
      if (next !== 'none') {
        track('overlay.opened', { overlayId: next });
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
        />
      </GuidedTourProvider>
    </ErrorBoundary>
  );
}
