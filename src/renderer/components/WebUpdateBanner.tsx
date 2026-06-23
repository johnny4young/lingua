import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCcw, X } from 'lucide-react';
import { useWebVersionPolling } from '../hooks/useWebVersionPolling';
import { isVersionNewer } from '../utils/version';

/**
 * RL-061 Slice 5 — top-of-app banner that tells web users when the
 * deployed bundle is older than the latest published release.
 *
 * Renders only when:
 *   1. The polling hook returns a `remoteVersion`.
 *   2. `isVersionNewer(remote, pinned)` strictly true.
 *   3. The user has not dismissed it in this mount.
 *
 * Dismiss is in-memory only — a page reload re-evaluates and
 * re-shows if the bundle is still stale. Keeps the contract simple:
 * one banner per page-life, no persistent local-storage state to
 * leak across sessions.
 *
 * Desktop builds never reach this code path: the parent App.tsx
 * gates the mount on `!window.lingua` and the polling hook itself
 * short-circuits on `window.lingua` defined as a defense in depth.
 */
export function WebUpdateBanner() {
  const { t } = useTranslation();
  const { remoteVersion, pinnedVersion } = useWebVersionPolling();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (!remoteVersion) return null;
  if (!isVersionNewer(remoteVersion, pinnedVersion)) return null;

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="web-update-banner"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2.5 text-body text-foreground"
    >
      <div className="grid gap-0.5">
        <p className="font-medium leading-5">{t('update.banner.title')}</p>
        <p className="text-body-sm leading-5 text-muted">
          {t('update.banner.body', { version: remoteVersion })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleReload}
          data-testid="web-update-banner-reload"
          className="button-primary inline-flex items-center gap-1.5 px-3 py-1 text-body-sm"
        >
          <RefreshCcw size={12} aria-hidden="true" />
          {t('update.banner.reload')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('update.banner.dismiss')}
          data-testid="web-update-banner-dismiss"
          className="rounded-full p-1 text-muted transition-colors hover:text-foreground"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
