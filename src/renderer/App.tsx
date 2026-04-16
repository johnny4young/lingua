import { useEffect, useRef, useState } from 'react';
import { AppLayout } from './components/Layout';
import { GuidedTourProvider } from './components/GuidedTour/GuidedTourProvider';
import { useGuidedTour } from './components/GuidedTour/guidedTourContext';
import { SettingsModal } from './components/Settings/SettingsModal';
import { WhatsNewSection } from './components/Settings/WhatsNewSection';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { SnippetsModal } from './components/Snippets';
import { CHANGELOG_ENTRIES } from './data/changelog';
import { getActiveAppLanguage } from './i18n';
import { useAppInfo } from './hooks/useAppInfo';
import { useRunner } from './hooks/useRunner';
import { useDesktopSmoke } from './hooks/useDesktopSmoke';
import type { AppOverlay } from './hooks/useGlobalShortcuts';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useAutoRun } from './hooks/useAutoRun';
import { useProjectWatchSync } from './hooks/useProjectWatchSync';
import { useAppTheme } from './hooks/useAppTheme';
import { useEditorStore } from './stores/editorStore';
import { usePluginStore } from './stores/pluginStore';
import { useSessionStore } from './stores/sessionStore';
import { useSettingsStore } from './stores/settingsStore';
import { useUIStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';
import { desktopSmokeEnabled } from './utils/desktopSmoke';

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
  const saveActiveTab = useEditorStore((s) => s.saveActiveTab);
  const saveActiveTabAs = useEditorStore((s) => s.saveActiveTabAs);
  const openFileFromDisk = useEditorStore((s) => s.openFileFromDisk);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const lastSeenVersion = useSettingsStore((s) => s.lastSeenVersion);
  const setLastSeenVersion = useSettingsStore((s) => s.setLastSeenVersion);
  const { toggleSidebar, toggleConsole } = useUIStore();
  const initializePlugins = usePluginStore((s) => s.initialize);
  const initializeUpdates = useUpdateStore((s) => s.initialize);
  const appInfo = useAppInfo();
  const { hasCompletedTour, startTour } = useGuidedTour();
  const smokeEnabled = desktopSmokeEnabled();
  const hasRestoredSessionRef = useRef(false);
  const hasHandledWhatsNewRef = useRef(false);
  const hasHandledAutoTourRef = useRef(false);

  // Restore session on first mount if setting is enabled
  useEffect(() => {
    if (hasRestoredSessionRef.current || smokeEnabled) {
      return;
    }
    hasRestoredSessionRef.current = true;

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
    void initializePlugins();
  }, [initializePlugins]);

  useEffect(() => {
    void initializeUpdates();
  }, [initializeUpdates]);

  useEffect(() => {
    if (hasHandledWhatsNewRef.current || smokeEnabled) {
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
  }, [appInfo?.version, lastSeenVersion, openOverlay, overlay, setLastSeenVersion, smokeEnabled]);

  useEffect(() => {
    if (hasHandledAutoTourRef.current || smokeEnabled) {
      return;
    }

    if (!appInfo?.version || overlay !== 'none' || hasCompletedTour) {
      return;
    }

    hasHandledAutoTourRef.current = true;
    const timeout = window.setTimeout(() => {
      startTour();
    }, 260);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [appInfo?.version, hasCompletedTour, overlay, startTour, smokeEnabled]);

  // Auto-run code after the configured idle debounce
  useAutoRun();
  useProjectWatchSync();
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
            if (tab.filePath) {
              await window.lingua.fs.write(tab.filePath, tab.content);
              continue;
            }

            const chosenPath = await window.lingua.fs.saveDialog(tab.name);
            if (!chosenPath) {
              return;
            }

            await window.lingua.fs.write(chosenPath, tab.content);
          }

          window.lingua.forceClose();
        } else if (response === 1) {
          window.lingua.forceClose();
        }
      })();
    });
  }, []);

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
    closeOverlay,
  });

  const handleStartGuidedTour = () => {
    closeOverlay();
    startTour();
  };

  return (
    <>
      <AppLayout
        onOpenSettings={() => openOverlay('settings')}
        onOpenPalette={() => openOverlay('palette')}
        onOpenQuickOpen={() => openOverlay('quick-open')}
        onOpenSnippets={() => openOverlay('snippets')}
      />
      {overlay === 'quick-open' && <QuickOpen onClose={closeOverlay} />}
      {overlay === 'palette' && (
        <CommandPalette
          onClose={closeOverlay}
          onOpenSettings={() => openOverlay('settings')}
          onOpenWhatsNew={() => openOverlay('whats-new')}
          onStartGuidedTour={handleStartGuidedTour}
          onOpenSnippets={() => openOverlay('snippets')}
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
    </>
  );
}

export function App() {
  const [overlay, setOverlay] = useState<AppOverlay>('none');

  const openOverlay = (nextOverlay: Exclude<AppOverlay, 'none'>) => {
    setOverlay(nextOverlay);
  };

  const toggleOverlay = (nextOverlay: Exclude<AppOverlay, 'none'>) => {
    setOverlay((currentOverlay) => (currentOverlay === nextOverlay ? 'none' : nextOverlay));
  };

  const closeOverlay = () => {
    setOverlay('none');
  };

  return (
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
  );
}
