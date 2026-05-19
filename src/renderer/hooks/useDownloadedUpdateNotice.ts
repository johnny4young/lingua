import { useEffect, useRef } from 'react';
import { useUpdateStore } from '../stores/updateStore';
import { useUIStore } from '../stores/uiStore';

/**
 * Surface a renderer-side toast the first time we observe the
 * autoupdater landing on `status === 'downloaded'` in a session.
 *
 * Why this exists: before the fix landed, the only path that told
 * the user about a pending update was Settings → Updates, which is
 * easy to miss and lived behind a stale-state bug (the hourly poll
 * wiped the terminal `'downloaded'` status, so a user who didn't
 * open Settings within the ~1h window missed every release).
 *
 * Behavior:
 *   - Fires once per ('downloaded', releaseName) pair so a
 *     subsequent `'downloaded'` for a different version notifies
 *     again. A user could conceivably download v0.4.0, ignore the
 *     prompt, then later see v0.5.0 land in the same session —
 *     they deserve a fresh notice.
 *   - Reuses the existing `pushStatusNotice` toast pattern;
 *     `<StatusNoticeBanner>` is already mounted globally so no new
 *     DOM surface is added here.
 *   - Single-shot: the hook remembers the last release key so the
 *     toast does not stack on a re-render.
 */
export function useDownloadedUpdateNotice(): void {
  const status = useUpdateStore((state) => state.status);
  const releaseName = useUpdateStore((state) => state.releaseName);
  const lastNotifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'downloaded') return;
    // Key on the release identity so each downloaded version emits
    // exactly one notice per session. `releaseName` is `undefined`
    // on platforms that don't supply one — fall back to a stable
    // sentinel so we still notify exactly once.
    const key = releaseName ?? '__release__';
    if (lastNotifiedRef.current === key) return;
    lastNotifiedRef.current = key;
    useUIStore.getState().pushStatusNotice({
      tone: 'success',
      messageKey: releaseName
        ? 'updates.notice.downloaded'
        : 'updates.notice.downloadedGeneric',
      values: releaseName ? { version: releaseName } : undefined,
    });
  }, [status, releaseName]);
}
