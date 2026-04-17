import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';

const AUTO_DISMISS_MS = 6000;

/**
 * Ephemeral bottom-right toast surfacing transient notices such as format-on-save
 * parse errors or missing formatter binaries. Never blocks the editor — auto
 * dismisses after a short window and clears immediately when the user hits X.
 */
export function StatusNoticeBanner() {
  const { t } = useTranslation();
  const notice = useUIStore((state) => state.statusNotice);
  const dismissStatusNotice = useUIStore((state) => state.dismissStatusNotice);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => {
      dismissStatusNotice();
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [notice, dismissStatusNotice]);

  if (!notice) return null;

  const toneClass =
    notice.tone === 'error'
      ? 'border-danger/60 bg-danger/10 text-danger'
      : notice.tone === 'success'
        ? 'border-success/60 bg-success/10 text-success'
        : 'border-border/80 bg-surface/85 text-foreground';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="status-notice-banner"
      className={`pointer-events-auto fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 rounded-[1.1rem] border px-4 py-3 shadow-xl backdrop-blur ${toneClass}`}
    >
      <div className="grid gap-1 text-sm">
        <p className="font-medium leading-5">{t(notice.messageKey, notice.values)}</p>
        {notice.detail ? (
          <p className="max-h-32 overflow-auto text-xs leading-5 text-muted">{notice.detail}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismissStatusNotice}
        aria-label={t('statusNotice.dismiss')}
        className="ml-auto rounded-full p-1 text-muted transition-colors hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}
