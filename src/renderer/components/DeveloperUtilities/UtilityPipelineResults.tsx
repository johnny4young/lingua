/** Utility pipeline results, read as a run: each step's output as an answer, with the breakpoint held inline. */

import { ChevronDown, PackagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { breakpointStepId as breakpointOf, heldStepId, type PipelineRunState } from '../../hooks/useUtilityPipelineRun';
import { getAdapter } from '../../../shared/utilities/registry';
import type { UtilityAdapterId } from '../../../shared/utilities/types';
import type { PipelineStepResult } from '../../../shared/utilityPipeline';
import { cn } from '../../utils/cn';
import { formatWholeDuration } from '../../utils/latencyScale';
import { AnswerObject } from '../Answer/AnswerObject';
import { DotLeader, TypeTag } from '../ui/answer';
import { Glyph } from '../ui/Glyph';
import { SendOutputCards } from './SendOutputCards';
import '../ui/pipelineRun.css';
import '../../i18n/clipboardChainsCatalog';

/** Rows without an output read as a tag and a line: what held, skipped or failed the step. */
const STATUS_LINE: Partial<Record<PipelineStepResult['status'], { tag: string; hint: string; tone?: 'error' | 'warning'; dim?: boolean }>> = {
  paused: { tag: 'utilityPipeline.result.tag.paused', hint: 'utilityPipeline.result.pausedHint', dim: true },
  disabled: { tag: 'utilityPipeline.step.status.disabled', hint: 'utilityPipeline.result.disabledHint', dim: true },
  skipped: { tag: 'utilityPipeline.step.status.skipped', hint: 'utilityPipeline.result.skippedHint', dim: true },
  error: { tag: 'utilityPipeline.step.status.error', hint: 'utilityPipeline.result.error', tone: 'error' },
  timeout: { tag: 'utilityPipeline.step.status.timeout', hint: 'utilityPipeline.result.timeout', tone: 'error' },
  incompatible: { tag: 'utilityPipeline.step.status.incompatible', hint: 'utilityPipeline.result.incompatibleHint', tone: 'warning' },
};

const TONE_TEXT = { error: 'text-value-error', warning: 'text-warning-fg' } as const;

/** `readLiteral` reads up to 20 000 characters; past that the head classifies the same. */
const ANSWER_TEXT_MAX = 20_001;

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** Statuses where the step's adapter actually ran. */
const RAN = new Set<PipelineStepResult['status']>(['ok', 'error', 'timeout']);

interface UtilityPipelineResultsProps {
  readonly runState: PipelineRunState;
  readonly canSaveCapsule: boolean;
  readonly onSaveCapsule: () => void;
  readonly onSendOutput: (afterStepId: string, utilityId: UtilityAdapterId) => void;
  readonly onContinue: (stepId: string) => void;
}

export function UtilityPipelineResults({
  runState,
  canSaveCapsule,
  onSaveCapsule,
  onSendOutput,
  onContinue,
}: UtilityPipelineResultsProps) {
  const { t } = useTranslation();
  const asideRef = useRef<HTMLElement>(null);
  const results = runState.stepResults;
  // Rows whose full output (and, at a breakpoint, input) is open, for these results only: a new run closes them.
  const [openedFor, setOpenedFor] = useState<{ results: readonly PipelineStepResult[]; ids: ReadonlySet<string> }>(() => ({ results, ids: new Set() }));
  const opened = openedFor.results === results ? openedFor.ids : EMPTY_IDS;
  const firstPaused = results.findIndex((result) => result.status === 'paused');
  const paused = firstPaused !== -1;
  const breakpointStepId = breakpointOf(results);
  const heldAt = heldStepId(runState);
  const ran = results.filter((result) => RAN.has(result.status)).length;
  // A paused run has no result to send yet: a new step would wait behind the breakpoint.
  const lastOutput =
    runState.phase === 'settled' && !paused
      ? [...results].reverse().find((result) => result.status === 'ok' && typeof result.output === 'string')
      : undefined;
  // These controls unmount when the run starts, so keyboard focus moves to their region first.
  const keepFocus = () => asideRef.current?.focus();
  const toggle = (stepId: string, open: boolean) => {
    const ids = new Set(opened);
    if (open) ids.add(stepId);
    else ids.delete(stepId);
    setOpenedFor({ results, ids });
  };

  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      data-testid="utility-pipeline-result"
      className="utility-pipeline-results @container flex min-h-0 flex-col outline-none"
    >
      <header className="flex items-center gap-2 pb-2">
        <span className="text-caption font-bold uppercase tracking-[0.12em] text-muted">{t('utilityPipeline.result.title')}</span>
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
        <ol className="min-h-0 overflow-y-auto border-t border-border-subtle">
          {results.map((result, index) => {
            const title = t(getAdapter(result.utilityId)?.titleKey ?? result.utilityId);
            const isBreakpoint = result.stepId === breakpointStepId;
            const output = result.status === 'ok' ? result.output : undefined;
            const hasOutput = typeof output === 'string';
            const open = hasOutput && opened.has(result.stepId);
            const held = result.status === 'paused' && index === firstPaused;
            const line = STATUS_LINE[result.status];
            const detailId = `utility-pipeline-output-${result.stepId}`;
            return (
              <li
                key={result.stepId}
                data-testid="utility-pipeline-result-row"
                data-status={result.status}
                data-dim={line?.dim && !held ? '' : undefined}
                className="border-b border-border-subtle"
              >
                <div className="utility-step-line">
                  <span className="pipeline-step-numeral" data-size="sm" aria-hidden>
                    {index + 1}
                  </span>
                  <span className="utility-step-title">
                    {isBreakpoint ? (
                      <span
                        role="img"
                        aria-label={t('utilityPipeline.step.breakpoint')}
                        data-testid="utility-pipeline-result-breakpoint"
                        className="utility-step-breakpoint"
                      />
                    ) : null}
                    <span className="truncate">{title}</span>
                  </span>
                  <DotLeader className="utility-step-leader" />
                  <div className="utility-step-value">
                    {output === '' ? <span className="utility-step-hint">{t('utilityPipeline.result.emptyOutput')}</span> : null}
                    {output ? <StepAnswer output={output} utilityId={result.utilityId} /> : null}
                    {line ? (
                      <>
                        <TypeTag className={cn('utility-step-tag', line.tone && TONE_TEXT[line.tone])}>
                          {t(line.tag)}
                        </TypeTag>
                        {result.status !== 'paused' || held ? (
                          <span
                            className={cn('utility-step-hint', held && 'pipeline-hold')}
                            data-tone={line.tone}
                            data-testid={line.tone ? 'utility-pipeline-result-error' : undefined}
                          >
                            {(line.tone && result.errorMessage) || t(line.hint)}
                          </span>
                        ) : null}
                        {held && heldAt ? (
                          <button
                            type="button"
                            onClick={() => {
                              keepFocus();
                              onContinue(heldAt);
                            }}
                            data-testid="utility-pipeline-continue"
                            className="button-primary h-6 shrink-0 px-2.5 text-caption"
                          >
                            <Glyph name="continue" size={11} />
                            {t('utilityPipeline.result.continue')}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  {RAN.has(result.status) ? (
                    <span className="pipeline-step-time utility-step-time" data-testid="utility-pipeline-result-time">
                      {formatWholeDuration(result.durationMs)}
                    </span>
                  ) : (
                    // Holds the time's place, so a row that did not run keeps its tag in the same column.
                    <span aria-hidden className="pipeline-step-time utility-step-time" />
                  )}
                  {hasOutput ? (
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={t('utilityPipeline.result.showOutput', { index: index + 1 })}
                      title={t('utilityPipeline.result.showOutput', { index: index + 1 })}
                      onClick={() => toggle(result.stepId, !open)}
                      data-testid="utility-pipeline-result-toggle"
                      className="utility-step-toggle focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg-base"
                    >
                      <ChevronDown size={13} aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />
                    </button>
                  ) : (
                    // Holds the toggle's place, so every row's tag starts in one column.
                    <span aria-hidden className="utility-step-toggle h-6 w-6 shrink-0" />
                  )}
                </div>
                {hasOutput ? (
                  <div id={detailId} hidden={!open} className="utility-step-detail">
                    {isBreakpoint ? (
                      <>
                        <TypeTag>{t('utilityPipeline.result.inputLabel')}</TypeTag>
                        <pre data-testid="utility-pipeline-result-input" data-input="" className="utility-step-pre">
                          {result.input}
                        </pre>
                        <TypeTag>{t('utilityPipeline.result.outputLabel')}</TypeTag>
                      </>
                    ) : null}
                    <pre data-testid="utility-pipeline-result-output" className="utility-step-pre">
                      {output}
                    </pre>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {lastOutput?.output !== undefined ? (
        <div className="pt-5">
          <SendOutputCards
            testId="utility-pipeline-send"
            output={lastOutput.output}
            exclude={lastOutput.utilityId}
            onSend={(id) => {
              keepFocus();
              onSendOutput(lastOutput.stepId, id);
            }}
          />
        </div>
      ) : null}
      {runState.phase !== 'idle' && results.length > 0 ? (
        <p data-testid="utility-pipeline-run-summary" className="mt-auto pt-2.5 text-caption text-fg-subtle">
          {t('utilityPipeline.result.ranOf', { ran, count: results.length })}
          {paused ? ` · ${t('utilityPipeline.result.pausedAt', { index: firstPaused + 1 })}` : ''}
        </p>
      ) : null}
    </aside>
  );
}

/** A json adapter's output reads as an object; any other output reads as text, never parsed. */
function StepAnswer({ output, utilityId }: { readonly output: string; readonly utilityId: UtilityAdapterId }) {
  // The head is enough to read the kind; a 256 KiB line would otherwise be laid out whole.
  const head = output.slice(0, ANSWER_TEXT_MAX);
  const json = getAdapter(utilityId)?.outputKind === 'json';
  return (
    <AnswerObject
      text={head}
      {...(json ? {} : { role: 'text' as const })}
      length={output.length}
      data-testid="utility-pipeline-result-answer"
    />
  );
}
