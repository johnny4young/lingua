import { BarChart3, Loader2, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  SqlColumnProfile,
  SqlColumnProfileOutcome,
} from '../../runtime/sqlColumnProfile';

interface SqlColumnProfilePanelProps {
  outcome: SqlColumnProfileOutcome | null;
  isLoading: boolean;
  onClose: () => void;
  onRetry: () => void;
}

const PROFILE_METRICS: ReadonlyArray<{
  key: keyof Pick<
    SqlColumnProfile,
    'nullPercentage' | 'approximateUnique' | 'min' | 'max' | 'average' | 'standardDeviation'
  >;
  labelKey: string;
}> = [
  { key: 'nullPercentage', labelKey: 'sqlWorkspace.profile.nulls' },
  { key: 'approximateUnique', labelKey: 'sqlWorkspace.profile.unique' },
  { key: 'min', labelKey: 'sqlWorkspace.profile.minimum' },
  { key: 'max', labelKey: 'sqlWorkspace.profile.maximum' },
  { key: 'average', labelKey: 'sqlWorkspace.profile.average' },
  { key: 'standardDeviation', labelKey: 'sqlWorkspace.profile.standardDeviation' },
];

/**
 * The SQL result column doubles as a lightweight column-explorer drawer. It
 * keeps profile data local and ephemeral so a profile cannot be confused with
 * a saved SQL run or a replayable history item.
 */
export function SqlColumnProfilePanel({
  outcome,
  isLoading,
  onClose,
  onRetry,
}: SqlColumnProfilePanelProps) {
  const { t } = useTranslation();
  const failed =
    outcome !== null &&
    outcome.status !== 'success' &&
    outcome.status !== 'too-large';
  const failureMessage =
    outcome !== null && 'errorMessage' in outcome ? outcome.errorMessage : undefined;
  const profiles =
    outcome?.status === 'success' || outcome?.status === 'too-large'
      ? outcome.profiles
      : [];

  return (
    <section
      data-testid="sql-column-profile-panel"
      aria-label={t('sqlWorkspace.profile.title')}
      aria-busy={isLoading}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-base"
    >
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <BarChart3 size={15} aria-hidden="true" className="text-accent" />
        <h3 className="min-w-0 flex-1 truncate text-body-sm font-semibold text-fg-base">
          {t('sqlWorkspace.profile.title')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          data-testid="sql-column-profile-close"
          aria-label={t('sqlWorkspace.profile.close')}
          title={t('sqlWorkspace.profile.close')}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-panel-alt hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      {isLoading ? (
        <div
          role="status"
          data-testid="sql-column-profile-loading"
          className="grid flex-1 place-items-center px-5 py-8 text-center text-body-sm text-fg-subtle"
        >
          <span className="inline-flex items-center gap-2">
            <Loader2 size={15} aria-hidden="true" className="animate-spin" />
            {t('sqlWorkspace.profile.loading')}
          </span>
        </div>
      ) : failed ? (
        <div className="grid flex-1 place-items-center px-5 py-8 text-center">
          <div role="alert" data-testid="sql-column-profile-error" className="max-w-sm">
            <p className="text-body-sm font-medium text-error-fg">
              {t('sqlWorkspace.profile.error')}
            </p>
            {failureMessage ? (
              <p className="mt-1 text-caption text-fg-subtle">
                {failureMessage}
              </p>
            ) : null}
            <button
              type="button"
              onClick={onRetry}
              data-testid="sql-column-profile-retry"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 py-1.5 text-caption font-medium text-fg-base transition-colors hover:border-border-strong hover:bg-bg-panel-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <RotateCcw size={12} aria-hidden="true" />
              {t('sqlWorkspace.profile.retry')}
            </button>
          </div>
        </div>
      ) : profiles.length === 0 ? (
        <p
          data-testid="sql-column-profile-empty"
          className="grid flex-1 place-items-center px-5 py-8 text-center text-body-sm text-fg-subtle"
        >
          {t('sqlWorkspace.profile.empty')}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {outcome?.status === 'too-large' ? (
            <p className="mb-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-caption text-warning-fg">
              {t('sqlWorkspace.profile.truncated')}
            </p>
          ) : null}
          <ul className="space-y-2" aria-label={t('sqlWorkspace.profile.columns')}>
            {profiles.map((profile, index) => (
              <li
                key={`${profile.columnName}:${index}`}
                data-testid="sql-column-profile-item"
                className="rounded-md border border-border-subtle bg-bg-panel p-3"
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <h4 className="min-w-0 truncate font-mono text-caption font-semibold text-fg-base">
                    {profile.columnName}
                  </h4>
                  <span className="shrink-0 rounded-sm bg-bg-panel-alt px-1.5 py-0.5 font-mono text-eyebrow text-fg-muted">
                    {profile.columnType}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                  {PROFILE_METRICS.map((metric) => (
                    <div key={metric.key} className="min-w-0">
                      <dt className="text-eyebrow uppercase tracking-wide text-fg-subtle">
                        {t(metric.labelKey)}
                      </dt>
                      <dd className="truncate font-mono text-caption text-fg-base">
                        {profile[metric.key] === null
                          ? t('sqlWorkspace.profile.notAvailable')
                          : metric.key === 'nullPercentage'
                            ? // SUMMARIZE's null_percentage is a percent value.
                              `${profile[metric.key]}%`
                            : profile[metric.key]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
