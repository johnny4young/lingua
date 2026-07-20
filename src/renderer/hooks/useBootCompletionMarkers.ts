import { useEffect } from 'react';
import { finishBootTiming, markBootPhase } from '../utils/bootTimings';

/** internal — mark the first painted AppLayout and completed boot rehydration. */
export function useBootCompletionMarkers(rehydrationReady: boolean): void {
  useEffect(() => {
    const firstPaintFrame = window.requestAnimationFrame(() => {
      markBootPhase('first-paint');
      if (!rehydrationReady) return;
      window.requestAnimationFrame(() => finishBootTiming());
    });
    return () => window.cancelAnimationFrame(firstPaintFrame);
  }, [rehydrationReady]);
}
