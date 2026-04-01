import { useEffect } from 'react';
import { AppLayout } from './components/Layout';
import { useRunner } from './hooks/useRunner';
import { useEditorStore } from './stores/editorStore';

export function App() {
  const { run, stop, isRunning } = useRunner();
  const saveActiveTab = useEditorStore((s) => s.saveActiveTab);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + Enter — run or stop
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (isRunning) {
          stop();
        } else {
          run();
        }
        return;
      }

      // Cmd/Ctrl + S — save active tab
      if (mod && e.key === 's') {
        e.preventDefault();
        saveActiveTab();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [run, stop, isRunning, saveActiveTab]);

  return <AppLayout />;
}
