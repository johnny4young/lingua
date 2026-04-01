import { useEffect } from 'react';
import { AppLayout } from './components/Layout';
import { useRunner } from './hooks/useRunner';

export function App() {
  const { run, stop, isRunning } = useRunner();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Enter (Mac) or Ctrl+Enter (Win/Linux) to run
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (isRunning) {
          stop();
        } else {
          run();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [run, stop, isRunning]);

  return <AppLayout />;
}
