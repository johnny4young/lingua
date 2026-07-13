/** Streaming output region for the Utility Pipelines workspace. */

import { PackagePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PipelineRunState } from '../../hooks/useUtilityPipelineRun';

interface UtilityPipelineResultsProps {
  readonly runState: PipelineRunState;
  readonly canSaveCapsule: boolean;
  readonly onSaveCapsule: () => void;
}

export function UtilityPipelineResults({
  runState,
  canSaveCapsule,
  onSaveCapsule,
}: UtilityPipelineResultsProps) {
  const { t } = useTranslation();

  return (
    <aside
      data-testid="utility-pipeline-result"
      className="flex min-h-0 flex-col gap-2 border-l border-border/60 pl-2"
    >
      <header className="flex items-center gap-2 pb-1">
        <span className="text-caption font-bold uppercase tracking-[0.12em] text-muted">
          {t('utilityPipeline.result.title')}
        </span>
        <button
          type="button"
          onClick={onSaveCapsule}
          disabled={!canSaveCapsule}
          data-testid="pipeline-save-capsule"
          title={t('pipeline.capsule.saveAction')}
          className="focus-ring ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-eyebrow font-medium text-muted hover:border-border-strong hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PackagePlus size={11} aria-hidden="true" />
          <span>{t('pipeline.capsule.saveAction')}</span>
        </button>
      </header>
      {runState.phase === 'idle' ? (
        <p className="text-body-sm text-muted">{t('utilityPipeline.result.empty')}</p>
      ) : (
        <ol className="flex-1 space-y-2 overflow-y-auto pr-1">
          {runState.stepResults.map((result, index) => (
            <li
              key={result.stepId}
              data-testid="utility-pipeline-result-row"
              data-status={result.status}
              className="grid gap-1 rounded border border-border/40 bg-surface/30 p-2"
            >
              <header className="flex items-center gap-2 text-eyebrow text-muted">
                <span className="font-bold uppercase tracking-wider">
                  {t('utilityPipeline.result.stepLabel', { index: index + 1 })}
                </span>
                <span className="font-mono text-foreground">{result.utilityId}</span>
                <span className="ml-auto tabular-nums">{result.durationMs} ms</span>
              </header>
              {result.status === 'ok' && typeof result.output === 'string' ? (
                <pre
                  data-testid="utility-pipeline-result-output"
                  className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded bg-background-elevated/60 p-2 font-mono text-eyebrow text-foreground"
                >
                  {result.output.length === 0
                    ? t('utilityPipeline.result.emptyOutput')
                    : result.output}
                </pre>
              ) : null}
              {result.status === 'error' || result.status === 'timeout' ? (
                <p
                  data-testid="utility-pipeline-result-error"
                  className="font-mono text-eyebrow text-rose-300"
                >
                  {result.errorMessage ?? t(`utilityPipeline.result.${result.status}`)}
                </p>
              ) : null}
              {result.status === 'skipped' ? (
                <p className="text-eyebrow text-muted">{t('utilityPipeline.result.skippedHint')}</p>
              ) : null}
              {result.status === 'incompatible' ? (
                <p className="font-mono text-eyebrow text-amber-300">
                  {result.errorMessage ?? t('utilityPipeline.result.incompatibleHint')}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
