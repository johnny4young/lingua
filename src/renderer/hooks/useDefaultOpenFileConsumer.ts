/**
 * RL-044 Slice 2b-β-α Fold H — default `lingua-open-file` consumer.
 *
 * When user clicks a clickable stack frame in `<RichValueError>`, the
 * component dispatches `CustomEvent('lingua-open-file', { detail: {
 * file, line, column?, fnName? } })` on `window`. RL-024 multi-file
 * workspace will register the real consumer; until that ships, this
 * hook provides a default fallback that shows a non-blocking status
 * notice so users get visible feedback that the click was recognised.
 *
 * Debounce: stack-trace clicks can fire in rapid bursts; we squelch
 * duplicate file:line within a 1500ms window so toasts don't stack.
 */

import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';

interface LinguaOpenFileDetail {
  file?: unknown;
  line?: unknown;
  column?: unknown;
  fnName?: unknown;
}

const RECENT_DEBOUNCE_MS = 1500;
const MAX_RECENT_KEYS = 32;

export function useDefaultOpenFileConsumer(): void {
  useEffect(() => {
    const recentKeys = new Map<string, number>();

    const handler = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      // RL-024 will register a higher-priority consumer that calls
      // `event.preventDefault()` after opening the file. Skip the
      // fallback toast in that case so users don't see both the
      // file open AND the "coming soon" notice.
      if (event.defaultPrevented) return;
      const detail = event.detail as LinguaOpenFileDetail | null | undefined;
      const file = typeof detail?.file === 'string' ? detail.file : '';
      const line = typeof detail?.line === 'number' ? detail.line : 0;
      if (!file || line <= 0) return;
      const key = `${file}:${line}`;
      const now = Date.now();
      const last = recentKeys.get(key) ?? 0;
      if (now - last < RECENT_DEBOUNCE_MS) return;
      recentKeys.set(key, now);
      // Trim old entries opportunistically so the Map doesn't grow.
      if (recentKeys.size > MAX_RECENT_KEYS) {
        for (const [k, ts] of recentKeys) {
          if (now - ts > RECENT_DEBOUNCE_MS * 4) recentKeys.delete(k);
        }
        while (recentKeys.size > MAX_RECENT_KEYS) {
          const oldestKey = recentKeys.keys().next().value as string | undefined;
          if (oldestKey === undefined) break;
          recentKeys.delete(oldestKey);
        }
      }
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'openFile.toast.unavailable',
        values: { file, line },
      });
    };

    window.addEventListener('lingua-open-file', handler);
    return () => {
      window.removeEventListener('lingua-open-file', handler);
    };
  }, []);
}
