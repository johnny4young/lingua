import { useEffect, useState } from 'react';
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
import { useUIStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';
import { useAutoRun } from './hooks/useAutoRun';
import { useProjectWatchSync } from './hooks/useProjectWatchSync';

export function App() {
  const { run, stop, isRunning } = useRunner();
  const saveActiveTab = useEditorStore((s) => s.saveActiveTab);
  const removeTab = useEditorStore((s) => s.removeTab);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const { toggleSidebar, toggleConsole } = useUIStore();
  const initializePlugins = usePluginStore((s) => s.initialize);
  const initializeUpdates = useUpdateStore((s) => s.initialize);

  const [overlay, setOverlay] = useState<AppOverlay>('none');

  useEffect(() => {
    void initializePlugins();
  }, [initializePlugins]);

  useEffect(() => {
    void initializeUpdates();
  }, [initializeUpdates]);

  // Auto-run code after 2 seconds of no typing
  useAutoRun();
  useProjectWatchSync();

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
    closeActiveTab: () => {
      if (activeTabId) {
        removeTab(activeTabId);
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
