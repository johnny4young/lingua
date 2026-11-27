import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface NotebookStaleNoticeProps {
  readonly staleCount: number;
  readonly disabled: boolean;
  readonly onRefresh: () => void;
}

const GHOST_COUNT = 10;

/** The notebook's one stale notice, at the end of the toolbar, with the replay that clears it. */
export function NotebookStaleNotice({ staleCount, disabled, onRefresh }: NotebookStaleNoticeProps) {
  return (
    <div className="notebook-toolbar-notice">
      {/* An invisible two-digit notice holds the space, so the notice never moves the row or the cells. */}
      <GhostBanner />
      {/* The live region stays mounted, so the notice is announced when it appears. */}
      <div role="status" aria-live="polite" className="flex justify-end" data-testid="notebook-stale-notice-slot">
        {staleCount > 0 ? <StaleBanner count={staleCount} disabled={disabled} onRefresh={onRefresh} /> : null}
      </div>
    </div>
  );
}

function StaleBanner({
  count,
  ghost = false,
  disabled = false,
  onRefresh,
}: {
  count: number;
  ghost?: boolean;
  disabled?: boolean;
  onRefresh?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden={ghost || undefined}
      data-testid={ghost ? undefined : 'notebook-reactivity-banner'}
      title={ghost ? undefined : t('notebook.reactivity.lazyHint')}
      className={`notebook-stale-notice flex h-[30px] items-center gap-2.5 rounded-lg pl-3 pr-1 text-caption ${ghost ? 'invisible' : ''}`}
    >
      <span className="font-semibold text-warning-fg">{t('notebook.reactivity.summary', { count })}</span>
      <span className="hidden text-fg-muted min-[1800px]:inline">{t('notebook.reactivity.lazyHint')}</span>
      {ghost ? (
        <span className="inline-flex h-[22px] items-center px-2.5 font-medium">
          {t('notebook.reactivity.refreshButton', { count })}
        </span>
      ) : (
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled}
          title={t('notebook.reactivity.refreshHint')}
          data-testid="notebook-toolbar-refresh-stale"
          className="focus-ring inline-flex h-[22px] shrink-0 items-center rounded-md border border-border-default bg-bg-base px-2.5 font-medium text-fg-base transition-colors duration-150 hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('notebook.reactivity.refreshButton', { count })}
        </button>
      )}
    </div>
  );
}

const GhostBanner = memo(function GhostBanner() {
  return <StaleBanner count={GHOST_COUNT} ghost />;
});
