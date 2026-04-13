import { useEffect, useRef, useState } from 'react';
import { AppLayout } from './components/Layout';
import { SettingsModal } from './components/Settings/SettingsModal';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { SnippetsModal } from './components/Snippets';
import { useRunner } from './hooks/useRunner';
import type { AppOverlay } from './hooks/useGlobalShortcuts';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useEditorStore } from './stores/editorStore';
import { usePluginStore } from './stores/pluginStore';
import { useSessionStore } from './stores/sessionStore';
import { useSettingsStore } from './stores/settingsStore';
import { useUIStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';
import { useAutoRun } from './hooks/useAutoRun';
import { useProjectWatchSync } from './hooks/useProjectWatchSync';
import { useAppTheme } from './hooks/useAppTheme';

export function App() {
  const { run, stop, isRunning } = useRunner();
  const saveActiveTab = useEditorStore((s) => s.saveActiveTab);
  const saveActiveTabAs = useEditorStore((s) => s.saveActiveTabAs);
  const openFileFromDisk = useEditorStore((s) => s.openFileFromDisk);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const { toggleSidebar, toggleConsole } = useUIStore();
  const initializePlugins = usePluginStore((s) => s.initialize);
  const initializeUpdates = useUpdateStore((s) => s.initialize);

  const [overlay, setOverlay] = useState<AppOverlay>('none');
  const hasRestoredSessionRef = useRef(false);

  // Restore session on first mount if setting is enabled
  useEffect(() => {
    if (hasRestoredSessionRef.current) {
      return;
    }
    hasRestoredSessionRef.current = true;

    const { restoreSession } = useSettingsStore.getState();
    if (restoreSession) {
      void useSessionStore.getState().restoreSession();
    }
  }, []);

  // Auto-save session when tabs change (debounced)
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const unsubscribe = useEditorStore.subscribe(() => {
      const { restoreSession } = useSettingsStore.getState();
      if (!restoreSession) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        useSessionStore.getState().saveSession();
      }, 1000);
    });
    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    void initializePlugins();
  }, [initializePlugins]);

  useEffect(() => {
    void initializeUpdates();
  }, [initializeUpdates]);

  // Auto-run code after 2 seconds of no typing
  useAutoRun();
  useProjectWatchSync();
  useAppTheme();

  // Dirty-close handler: check for unsaved tabs before app close
  useEffect(() => {
    if (!window.lingua?.onBeforeClose) return;
    return window.lingua.onBeforeClose(() => {
      const { tabs } = useEditorStore.getState();
      const dirtyTabs = tabs.filter((t) => t.isDirty);
      if (dirtyTabs.length === 0) {
        window.lingua.forceClose();
        return;
      }
      void (async () => {
        const response = await window.lingua.confirmClose(
          dirtyTabs.map((t) => t.name)
        );
        if (response === 0) {
          // Save all dirty tabs, including untitled tabs that still need a path.
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
          // Discard
          window.lingua.forceClose();
        }
        // response === 2: Cancel — do nothing
      })();
    });
  }, []);

  const openOverlay = (nextOverlay: Exclude<AppOverlay, 'none'>) => {
    setOverlay(nextOverlay);
  };

  const toggleOverlay = (nextOverlay: Exclude<AppOverlay, 'none'>) => {
    setOverlay((currentOverlay) => (currentOverlay === nextOverlay ? 'none' : nextOverlay));
  };

  const closeOverlay = () => {
    setOverlay('none');
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
    closeOverlay,
  });

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
          onOpenSnippets={() => openOverlay('snippets')}
        />
      )}
      {overlay === 'settings' && <SettingsModal onClose={closeOverlay} />}
      {overlay === 'snippets' && <SnippetsModal onClose={closeOverlay} />}
    </>
  );
}
