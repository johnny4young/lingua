import { useTranslation } from 'react-i18next';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { cn } from '../../utils/cn';

const STRIP_RUNS = 5;

/** Last five runs as bars scaled to the slowest; a bar opens Compare when it applies. */
export function RunHistoryStrip({ onCompare }: { onCompare?: () => void }) {
  const { t } = useTranslation();
  const entries = useExecutionHistoryStore(state => state.entries);
  const runs = entries.slice(-STRIP_RUNS);
  if (runs.length === 0) return null;
  const slowest = Math.max(1, ...runs.map(run => run.durationMs ?? 0));

  return (
    <div
      data-testid="run-history-strip"
      className="flex h-10 shrink-0 items-center gap-3 border-t border-border-subtle px-3.5"
    >
      <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-fg-subtle">
        {t('dock.runHistory.title')}
      </span>
      <div
        role="group"
        aria-label={t('dock.runHistory.groupLabel', { count: runs.length })}
        className="flex h-[18px] w-[120px] items-end gap-1"
      >
        {runs.map((run, index) => {
          const failed = run.status !== 'ok';
          const current = index === runs.length - 1;
          const label = failed
            ? t('dock.runHistory.runFailed', { number: index + 1 })
            : t('dock.runHistory.run', {
                number: index + 1,
                duration: (run.durationMs ?? 0).toFixed(1),
              });
          return (
            <button
              key={run.id}
              type="button"
              data-run-status={failed ? 'err' : 'ok'}
              data-run-last={current ? 'true' : 'false'}
              aria-label={current ? t('dock.runHistory.current', { label }) : label}
              title={current ? t('dock.runHistory.current', { label }) : label}
              disabled={!onCompare}
              onClick={onCompare}
              className={cn(
                'run-history-bar flex-1 rounded-[2px] disabled:cursor-default',
                failed ? 'bg-error-border' : current ? 'bg-accent' : 'bg-border-strong'
              )}
              style={{
                height: failed
                  ? '30%'
                  : `${Math.max(20, Math.round(((run.durationMs ?? 0) / slowest) * 100))}%`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
