import { useEffect, useRef } from 'react';

type DesktopSmokeRunner = typeof import('./desktopSmokeRunner');

function failSmoke(error: unknown): void {
  console.error('[desktop-smoke] failed to load or start the renderer harness', error);
  window.lingua?.desktopSmoke?.finish(false);
}

export function useDesktopSmoke(enabled: boolean): void {
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!enabled || hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;
    void import('./desktopSmokeRunner')
      .then((runner: DesktopSmokeRunner) => runner.runDesktopSmoke())
      .catch(failSmoke);
  }, [enabled]);
}
