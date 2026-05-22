/**
 * RL-044 Slice 2b-β-α Fold H — default `lingua-open-file` consumer.
 *
 * When the user clicks a clickable stack frame in `<RichValueError>`
 * or an `<OutputLineBadge>` chip (RL-044 Sub-slice G), the component
 * dispatches `CustomEvent('lingua-open-file', { detail: { file,
 * line, column?, fnName? } })` on `window`.
 *
 * Two routing paths:
 *   1. `file` is a non-empty string — cross-file click (stack frame).
 *      RL-024 multi-file workspace will register a higher-priority
 *      consumer that opens the file; until that ships, this hook
 *      falls back to a status notice so users get visible feedback.
 *   2. `file` is empty / absent — within-tab click (Sub-slice G
 *      `<OutputLineBadge>` from a single-tab session, plus a future
 *      stack frame whose `file` is unresolved). Move the cursor in
 *      the currently-active editor model via
 *      `editorStore.requestReveal({ tabId: activeTabId, line, column })`.
 *      Falls through silently when no tab is active (safe-mode
 *      boot, no tabs ever opened).
 *
 * Debounce: clicks can fire in rapid bursts; we squelch duplicate
 * `<file>:<line>` within a 1500ms window so toasts and reveal
 * requests don't stack. Within-tab clicks use `<active>:<line>`
 * as the bucket.
 */

import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
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
      // fallback for that case so users don't see both the file open
      // AND the within-tab cursor jump.
      if (event.defaultPrevented) return;
      const detail = event.detail as LinguaOpenFileDetail | null | undefined;
      const file = typeof detail?.file === 'string' ? detail.file : '';
      const line = typeof detail?.line === 'number' ? detail.line : 0;
      const column = typeof detail?.column === 'number' ? detail.column : undefined;
      if (line <= 0) return;

      const now = Date.now();
      const trimRecent = () => {
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
      };

      if (file) {
        // Cross-file path — show the "coming soon" notice until
        // RL-024 ships the higher-priority consumer.
        const key = `${file}:${line}`;
        const last = recentKeys.get(key) ?? 0;
        if (now - last < RECENT_DEBOUNCE_MS) return;
        recentKeys.set(key, now);
        trimRecent();
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'openFile.toast.unavailable',
          values: { file, line },
        });
        return;
      }

      // Within-tab path (RL-044 Sub-slice G).
      const { activeTabId, requestReveal } = useEditorStore.getState();
      if (!activeTabId) return;
      const key = `tab:${activeTabId}:${line}`;
      const last = recentKeys.get(key) ?? 0;
      if (now - last < RECENT_DEBOUNCE_MS) return;
      recentKeys.set(key, now);
      trimRecent();
      requestReveal({ tabId: activeTabId, line, column });
    };

    window.addEventListener('lingua-open-file', handler);
    return () => {
      window.removeEventListener('lingua-open-file', handler);
    };
  }, []);
}
