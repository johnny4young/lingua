import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompareResultsPanelProps } from './CompareResultsPanel';
import { loadCompareResultsPanel } from './compareResultsPanelLoader';

type CompareResultsPanelComponent = ComponentType<CompareResultsPanelProps>;

/**
 * Startup-safe activation boundary for the opt-in comparison surface.
 *
 * ResultPanel mounts this host only after a matching stable snapshot exists
 * and the user enables Compare. Until then the diff renderer, computed-diff
 * hook, and worker client remain outside the initial workspace graph.
 */
export function CompareResultsPanelHost({ language }: CompareResultsPanelProps) {
  const { t } = useTranslation();
  const [Panel, setPanel] = useState<CompareResultsPanelComponent | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadCompareResultsPanel()
      .then(module => {
        if (!active) return;
        setPanel(() => module.CompareResultsPanel);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[compare] failed to load the comparison panel', error);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (Panel) return <Panel language={language} />;

  if (failed) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
        role="alert"
        data-testid="compare-results-panel-load-failed"
      >
        <p className="text-body-sm text-fg-muted">{t('compare.panel.loadFailed')}</p>
        <button
          type="button"
          className="button-secondary"
          onClick={() => window.location.reload()}
        >
          {t('compare.panel.reload')}
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex h-full items-center justify-center px-6 text-center text-body-sm text-fg-muted"
      role="status"
      aria-live="polite"
      data-testid="compare-results-panel-loading"
    >
      {t('compare.panel.loading')}
    </div>
  );
}
