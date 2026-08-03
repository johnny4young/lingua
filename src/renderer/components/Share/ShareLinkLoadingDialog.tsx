import { useTranslation } from 'react-i18next';

/**
 * Small startup-safe shell shown while the share implementation or encoded
 * preview is being prepared. Keeping it separate lets both sides of the lazy
 * boundary provide immediate, cancellable feedback.
 */
export function ShareLinkLoadingDialog({ onClose }: { readonly onClose?: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('share.confirm.title')}
      aria-busy="true"
      data-testid="share-link-loading-dialog"
    >
      <div className="w-full max-w-[640px] overflow-hidden rounded-lg border border-border bg-bg-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">{t('share.confirm.title')}</p>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('share.confirm.cancel')}
              className="focus-ring rounded p-1 text-lg leading-none text-fg-subtle hover:text-fg"
            >
              ×
            </button>
          ) : null}
        </div>
        <div
          className="flex items-center gap-3 px-4 py-5 text-sm text-fg-muted"
          role="status"
          aria-live="polite"
        >
          <span
            className="size-4 animate-spin rounded-full border-2 border-border border-t-accent"
            aria-hidden="true"
          />
          {t('share.loading')}
        </div>
      </div>
    </div>
  );
}
