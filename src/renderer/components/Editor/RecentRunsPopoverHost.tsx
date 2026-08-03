import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { loadRecentRunsPopover, type RecentRunsPopoverProps } from './recentRunsPopoverLoader';

type RecentRunsPopoverComponent = ComponentType<RecentRunsPopoverProps>;

function RecentRunsPopoverLoadState({ failed }: { readonly failed: boolean }) {
  const { t } = useTranslation();

  return (
    <section
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      aria-label={t('executionHistory.tabPill.popoverTitle')}
      data-testid={failed ? 'recent-runs-popover-load-failed' : 'recent-runs-popover-loading'}
      className="surface-panel-strong absolute right-4 top-[calc(100%+0.55rem)] z-20 w-[min(20rem,calc(100%-2rem))] p-3"
    >
      <div className="flex min-h-20 flex-col items-center justify-center gap-3 text-center">
        <p className="text-body-sm text-muted">
          {t(failed ? 'executionHistory.tabPill.loadFailed' : 'executionHistory.tabPill.loading')}
        </p>
        {failed ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => window.location.reload()}
          >
            {t('executionHistory.tabPill.reload')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Activation boundary for the per-tab Recent Runs popover.
 *
 * The pill, count, upsell, and keyboard opener stay immediately available.
 * Row rendering, relative-time updates, pinning, and replay load only after
 * the user opens a Pro history popover.
 */
export function RecentRunsPopoverHost(props: RecentRunsPopoverProps) {
  const [Popover, setPopover] = useState<RecentRunsPopoverComponent | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (Popover || failed) return;
    let active = true;
    void loadRecentRunsPopover()
      .then(module => {
        if (!active) return;
        setPopover(() => module.RecentRunsPopover);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[execution-history] failed to load the Recent Runs popover', error);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [Popover, failed]);

  if (Popover) return <Popover {...props} />;
  return <RecentRunsPopoverLoadState failed={failed} />;
}
