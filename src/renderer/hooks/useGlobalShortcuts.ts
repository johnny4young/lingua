import { useEffect, useEffectEvent } from 'react';

export type AppOverlay = 'none' | 'settings' | 'palette' | 'quick-open';

interface UseGlobalShortcutsOptions {
  isRunning: boolean;
  run: () => void | Promise<void>;
  stop: () => void;
  saveActiveTab: () => void | Promise<void>;
  closeActiveTab: () => void;
  toggleSidebar: () => void;
  toggleConsole: () => void;
  overlay: AppOverlay;
  toggleOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  closeOverlay: () => void;
}

export function useGlobalShortcuts({
  isRunning,
  run,
  stop,
  saveActiveTab,
  closeActiveTab,
  toggleSidebar,
  toggleConsole,
  overlay,
  toggleOverlay,
  closeOverlay,
}: UseGlobalShortcutsOptions) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && !event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      if (isRunning) {
        stop();
      } else {
        void run();
      }
      return;
    }

    if (mod && !event.shiftKey && key === 's') {
      event.preventDefault();
      void saveActiveTab();
      return;
    }

    if (mod && !event.shiftKey && key === 'w') {
      event.preventDefault();
      closeActiveTab();
      return;
    }

    if (mod && !event.shiftKey && key === 'b') {
      event.preventDefault();
      toggleSidebar();
      return;
    }

    if (mod && !event.shiftKey && event.key === '\\') {
      event.preventDefault();
      toggleConsole();
      return;
    }

    if (mod && !event.shiftKey && key === 'p') {
      event.preventDefault();
      toggleOverlay('quick-open');
      return;
    }

    if (mod && event.shiftKey && key === 'p') {
      event.preventDefault();
      toggleOverlay('palette');
      return;
    }

    if (mod && !event.shiftKey && event.key === ',') {
      event.preventDefault();
      toggleOverlay('settings');
      return;
    }

    if (event.key === 'Escape' && overlay !== 'none') {
      event.preventDefault();
      closeOverlay();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handleKeyDown(event);
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handleKeyDown]);
}
