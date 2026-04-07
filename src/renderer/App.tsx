import { useEffect, useState } from 'react';
import { AppLayout } from './components/Layout';
import { SettingsModal } from './components/Settings/SettingsModal';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { useRunner } from './hooks/useRunner';
import { useEditorStore } from './stores/editorStore';
import { useUIStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';

export function App() {
  const { run, stop, isRunning } = useRunner();
  const saveActiveTab = useEditorStore((s) => s.saveActiveTab);
  const removeTab = useEditorStore((s) => s.removeTab);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const { toggleSidebar, toggleConsole } = useUIStore();
  const initializeUpdates = useUpdateStore((s) => s.initialize);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);

  const anyOverlayOpen = settingsOpen || paletteOpen || quickOpenOpen;

  useEffect(() => {
    void initializeUpdates();
  }, [initializeUpdates]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + Enter — run or stop
      if (mod && !e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        if (isRunning) stop(); else run();
        return;
      }

      // Cmd/Ctrl + S — save active tab
      if (mod && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        saveActiveTab();
        return;
      }

      // Cmd/Ctrl + W — close active tab
      if (mod && !e.shiftKey && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) removeTab(activeTabId);
        return;
      }

      // Cmd/Ctrl + B — toggle sidebar
      if (mod && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd/Ctrl + \ — toggle console
      if (mod && !e.shiftKey && e.key === '\\') {
        e.preventDefault();
        toggleConsole();
        return;
      }

      // Cmd/Ctrl + P — quick open (file finder)
      if (mod && !e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setPaletteOpen(false);
        setQuickOpenOpen((v) => !v);
        return;
      }

      // Cmd/Ctrl + Shift + P — command palette
      if (mod && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setQuickOpenOpen(false);
        setPaletteOpen((v) => !v);
        return;
      }

      // Cmd/Ctrl + , — settings
      if (mod && !e.shiftKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen((v) => !v);
        return;
      }

      // Escape — close any open overlay
      if (e.key === 'Escape' && anyOverlayOpen) {
        e.preventDefault();
        if (paletteOpen) { setPaletteOpen(false); return; }
        if (quickOpenOpen) { setQuickOpenOpen(false); return; }
        if (settingsOpen) { setSettingsOpen(false); return; }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    run, stop, isRunning,
    saveActiveTab, removeTab, activeTabId,
    toggleSidebar, toggleConsole,
    settingsOpen, paletteOpen, quickOpenOpen, anyOverlayOpen,
  ]);

  return (
    <>
      <AppLayout
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenQuickOpen={() => setQuickOpenOpen(true)}
      />
      {quickOpenOpen && <QuickOpen onClose={() => setQuickOpenOpen(false)} />}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onOpenSettings={() => { setPaletteOpen(false); setSettingsOpen(true); }}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
