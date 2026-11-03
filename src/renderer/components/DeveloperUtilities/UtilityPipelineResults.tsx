/** Streaming output region for the Utility Pipelines workspace. */

import { Lightbulb, PackagePlus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { classifyClipboard, type UtilitySuggestionId } from '../../clipboard/pasteHandlers';
import type { PipelineRunState } from '../../hooks/useUtilityPipelineRun';
import { getAdapter } from '../../../shared/utilities/registry';
import type { UtilityAdapterId } from '../../../shared/utilities/types';
import type { PipelineStepResult } from '../../../shared/utilityPipeline';
import { SendOutputSelect } from './SendOutputSelect';

/** The next step a kind of output usually wants; some kinds have no adapter. */
const NEXT_UTILITY: Partial<Record<UtilitySuggestionId, UtilityAdapterId>> = {
  jwt: 'jwt-decode',
  json: 'json-format',
  base64: 'base64-decode',
  timestamp: 'timestamp',
  color: 'color-convert',
};

function suggestedNext(result: PipelineStepResult): UtilityAdapterId | null {
  const kind = classifyClipboard(result.output ?? '');
  const next = kind ? NEXT_UTILITY[kind] : undefined;
  return next && next !== result.utilityId ? next : null;
}

interface UtilityPipelineResultsProps {
  readonly runState: PipelineRunState;
  readonly canSaveCapsule: boolean;
  readonly onSaveCapsule: () => void;
  /** Present when Labs › Clipboard-aware utilities is on. */
  readonly onSendOutput?: (afterStepId: string, utilityId: UtilityAdapterId) => void;
  readonly onContinue?: (stepId: string) => void;
}

export function UtilityPipelineResults({
  runState,
  canSaveCapsule,
  onSaveCapsule,
  onSendOutput,
  onContinue,
}: UtilityPipelineResultsProps) {
  const { t } = useTranslation();
  const lastOutput =
    runState.phase === 'settled' && onSendOutput
      ? [...runState.stepResults].reverse().find((result) => result.status === 'ok' && typeof result.output === 'string')
      : undefined;
  const next = lastOutput ? suggestedNext(lastOutput) : null;

  return (
    <aside
      data-testid="utility-pipeline-result"
      className="flex min-h-0 flex-col gap-2 @[67rem]:border-l @[67rem]:border-border/60 @[67rem]:pl-2"
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
          className="focus-ring ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-eyebrow font-medium text-muted hover:border-border-strong hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
              {typeof result.input === 'string' ? (
                <>
                  <span className="text-eyebrow text-muted">{t('utilityPipeline.result.inputLabel')}</span>
                  <pre
                    data-testid="utility-pipeline-result-input"
                    className="max-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-eyebrow"
                  >
                    {result.input}
                  </pre>
                  <span className="text-eyebrow text-muted">{t('utilityPipeline.result.outputLabel')}</span>
                </>
              ) : null}
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
              {typeof result.input === 'string' && onContinue && runState.phase === 'settled' ? (
                <button
                  type="button"
                  onClick={() => onContinue(result.stepId)}
                  data-testid="utility-pipeline-continue"
                  className="focus-ring inline-flex h-6 w-fit items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-caption font-medium text-foreground hover:border-border-strong"
                >
                  <Play size={11} aria-hidden="true" />
                  {t('utilityPipeline.result.continue')}
                </button>
              ) : null}
              {result.status === 'disabled' ? (
                <p className="text-eyebrow text-muted">{t('utilityPipeline.result.disabledHint')}</p>
              ) : null}
              {result.status === 'paused' ? (
                <p className="text-eyebrow text-muted">{t('utilityPipeline.result.pausedHint')}</p>
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
      {lastOutput && onSendOutput ? (
        <footer data-testid="utility-pipeline-send" className="flex flex-wrap items-center gap-2 pt-1">
          <SendOutputSelect testId="utility-pipeline-send-select" onSend={(id) => onSendOutput(lastOutput.stepId, id)} />
          {next ? (
            <button
              type="button"
              onClick={() => onSendOutput(lastOutput.stepId, next)}
              data-testid="utility-pipeline-send-suggested"
              className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-warning/45 bg-warning/10 px-2 text-caption font-medium text-warning-fg"
            >
              <Lightbulb size={11} aria-hidden="true" />
              {t(getAdapter(next)?.titleKey ?? next)}
            </button>
          ) : null}
        </footer>
      ) : null}
    </aside>
  );
}
