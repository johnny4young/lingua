/** Bounded HTTP pipelines, read as a run: a result header over each step's answer. */

import { ChevronLeft, Copy, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HTTP_PIPELINE_MAX_STEPS,
  createBlankHttpPipeline,
  type HttpPipelineRunSnapshot,
  type HttpPipelineV1,
} from '../../../shared/httpPipeline';
import type { HttpRequestV1 } from '../../../shared/httpWorkspaceSchema';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import '../../i18n/httpBuilderCatalog';
import { formatWholeDuration } from '../../utils/latencyScale';
import { OverlayBackdrop } from '../ui/chrome';
import { TypeTag } from '../ui/answer';
import { ResultHeader } from '../ui/ResultHeader';
import { maskSecretsForCapsule } from '../../../shared/httpEnvironment';
import { enabledCaptures, pipelineHost, summarizePipelineRun } from './httpPipelineReport';
import { scopedEnvironmentFor } from './httpScopes';
import { HttpPipelineStepRow } from './HttpPipelineStepRow';
import '../ui/pipelineRun.css';

interface HttpPipelineManagerProps {
  readonly onClose: () => void;
  readonly run: HttpPipelineRunSnapshot | null;
  readonly onRun: (pipeline: HttpPipelineV1) => void;
  readonly onStop: () => void;
}

const SEGMENT_TONES = ['var(--color-fg-subtle)', 'var(--color-fg-muted)'] as const;

export function HttpPipelineManager({ onClose, run, onRun, onStop }: HttpPipelineManagerProps) {
  const { t } = useTranslation();
  const pipelines = useWorkspaceToolStore(state => state.httpPipelines);
  const activeId = useWorkspaceToolStore(state => state.activeHttpPipelineId);
  const requests = useWorkspaceToolStore(state => state.requests);
  const environments = useWorkspaceToolStore(state => state.environments);
  const activeEnvironmentId = useWorkspaceToolStore(state => state.activeEnvironmentId);
  const active = useMemo(
    () => pipelines.find(pipeline => pipeline.id === activeId),
    [pipelines, activeId]
  );
  const store = useWorkspaceToolStore.getState;
  const isRunning = run?.phase === 'running';
  // A run belongs to the pipeline that started it; another selection reads as not run.
  const shownRun = run && active && run.pipelineId === active.id ? run : null;
  // The runner holds the pipeline it started, so edits to it mid-run would not apply.
  const runningHere = shownRun?.phase === 'running';
  const summary = useMemo(
    () => (shownRun && active ? summarizePipelineRun(active, shownRun) : null),
    [shownRun, active]
  );
  // Each step's request, and what it can use from the steps before it: the variables they capture.
  const stepRows = useMemo(() => {
    const byId = new Map(requests.map(request => [request.id, request]));
    const seen = new Set<string>();
    return (active?.steps ?? []).map(step => {
      const request = byId.get(step.requestId);
      const captured: ReadonlySet<string> = new Set(seen);
      if (step.enabled) for (const rule of enabledCaptures(request)) seen.add(rule.targetVariable.trim());
      return { step, request, captured };
    });
  }, [active, requests]);
  // The run sends to the active environment, so the dialog names it and the host the step paths leave out.
  // Resolved with the send-time scopes and masked like a capsule, so a secret value never shows.
  const environment = environments.find(entry => entry.id === activeEnvironmentId) ?? null;
  const firstRequest = stepRows.find(row => row.step.enabled)?.request;
  const host = firstRequest
    ? pipelineHost(maskSecretsForCapsule(firstRequest, scopedEnvironmentFor(firstRequest, environment)).url)
    : null;
  const environmentName = environment
    ? environment.name || t('httpWorkspace.environment.unnamed')
    : t('httpWorkspace.environment.selector.none');
  const resultByStep = useMemo(
    () => new Map(shownRun?.results.map(result => [result.stepId, result]) ?? []),
    [shownRun]
  );

  const create = (): void => {
    store().createHttpPipeline(
      createBlankHttpPipeline({
        id: crypto.randomUUID(),
        name: t('httpWorkspace.pipeline.untitled'),
      })
    );
  };
  const updateSteps = (steps: HttpPipelineV1['steps']): void => {
    if (active) store().updateHttpPipeline(active.id, { steps });
  };
  const requestLabel = (request: HttpRequestV1 | undefined): string =>
    request?.name || request?.url || t('httpWorkspace.requestList.rename.placeholder');

  // The backdrop moves, traps and restores focus; Escape stops here so the
  // HTTP workspace underneath keeps its own state.
  const handleEscape = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const halt = summary?.halt;
  const meta = summary
    ? [
        summary.segments.length > 0 ? formatWholeDuration(summary.totalMs) : null,
        halt ? t(`httpWorkspace.pipeline.${halt.key}`, { index: halt.index }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <OverlayBackdrop portal onKeyDown={handleEscape}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="http-pipeline-title"
        data-testid="http-pipeline-manager"
        className="flex h-[min(88vh,760px)] min-h-0 w-[min(96vw,1100px)] flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-base shadow-e3"
      >
        <header className="pipeline-titlebar">
          <h2 id="http-pipeline-title" className="shrink-0 text-body-sm text-fg-subtle">
            {t('httpWorkspace.pipeline.library')}
          </h2>
          {active ? (
            <>
              <span aria-hidden className="text-fg-subtle opacity-50">
                /
              </span>
              <input
                value={active.name}
                onChange={event =>
                  store().updateHttpPipeline(active.id, { name: event.target.value })
                }
                aria-label={t('httpWorkspace.pipeline.name')}
                title={active.name}
                className="focus-ring h-7 min-w-0 flex-1 text-ellipsis rounded-md border border-transparent bg-transparent px-1.5 text-body-sm font-medium text-fg-base hover:border-border-subtle focus:border-border-strong"
              />
              <button
                type="button"
                onClick={() =>
                  store().duplicateHttpPipeline(
                    active.id,
                    crypto.randomUUID(),
                    t('httpWorkspace.pipeline.copySuffix')
                  )
                }
                aria-label={t('httpWorkspace.pipeline.duplicate')}
                title={t('httpWorkspace.pipeline.duplicate')}
                className="pipeline-titlebar-icon focus-ring"
              >
                <Copy size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('httpWorkspace.pipeline.deleteConfirm')))
                    store().deleteHttpPipeline(active.id);
                }}
                aria-label={t('httpWorkspace.pipeline.delete')}
                title={t('httpWorkspace.pipeline.delete')}
                className="pipeline-titlebar-icon focus-ring"
                data-tone="danger"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
              {isRunning ? (
                <button
                  type="button"
                  onClick={onStop}
                  data-testid="http-pipeline-stop"
                  className="button-secondary pipeline-verb"
                >
                  <Square size={12} aria-hidden="true" />
                  <span className="pipeline-verb-label">{t('httpWorkspace.pipeline.stop')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onRun(active)}
                  disabled={!active.steps.some(step => step.enabled)}
                  data-testid="http-pipeline-run"
                  className="button-primary pipeline-verb"
                >
                  <Play size={12} aria-hidden="true" fill="currentColor" />
                  <span className="pipeline-verb-label">{t('httpWorkspace.pipeline.run')}</span>
                </button>
              )}
            </>
          ) : (
            <span className="flex-1" />
          )}
        </header>

        <div className="pipeline-body">
          <aside className="pipeline-library">
            <div className="flex items-center justify-between px-3 pb-1.5">
              <TypeTag>{t('httpWorkspace.pipeline.library')}</TypeTag>
              <button
                type="button"
                onClick={create}
                aria-label={t('httpWorkspace.pipeline.create')}
                title={t('httpWorkspace.pipeline.create')}
                className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-inset hover:text-fg-base"
              >
                <Plus size={13} aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {pipelines.length === 0 ? (
                <p className="px-3 py-2 text-body-sm text-fg-subtle">
                  {t('httpWorkspace.pipeline.empty')}
                </p>
              ) : null}
              {pipelines.map(pipeline => (
                <button
                  key={pipeline.id}
                  type="button"
                  onClick={() => store().setActiveHttpPipeline(pipeline.id)}
                  aria-current={pipeline.id === activeId ? 'true' : undefined}
                  className="pipeline-library-item focus-ring"
                >
                  <span className="min-w-0 flex-1 truncate">{pipeline.name}</span>
                  <span className="font-mono text-caption tabular-nums text-fg-subtle">
                    {pipeline.steps.length}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              data-testid="http-pipeline-back"
              className="pipeline-library-item focus-ring"
            >
              <ChevronLeft size={12} aria-hidden="true" />
              {t('httpWorkspace.pipeline.back')}
            </button>
          </aside>

          {!active ? (
            <div className="grid flex-1 place-items-center p-16 text-center">
              <div>
                <p className="text-body text-fg-muted">{t('httpWorkspace.pipeline.empty')}</p>
                <button type="button" onClick={create} className="button-primary mt-4">
                  {t('httpWorkspace.pipeline.create')}
                </button>
              </div>
            </div>
          ) : (
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ResultHeader
                workspace="pipe"
                numeral={
                  summary
                    ? {
                        value: summary.passed,
                        unit: t('httpWorkspace.pipeline.passedOf', { count: summary.total }),
                        attributes: {
                          'data-testid': 'http-pipeline-passed',
                          'data-phase': shownRun?.phase,
                        },
                      }
                    : undefined
                }
                status={
                  summary ? undefined : (
                    <span className="text-body-sm text-fg-muted">
                      {t('httpWorkspace.pipeline.ready')}
                    </span>
                  )
                }
                meta={meta || undefined}
                phases={
                  summary && summary.segments.length > 0
                    ? {
                        segments: summary.segments.map((segment, index) => ({
                          key: segment.key,
                          ms: segment.ms,
                          color: segment.failed
                            ? 'var(--color-value-error)'
                            : SEGMENT_TONES[index % 2]!,
                        })),
                        label: meta,
                        testId: 'http-pipeline-phases',
                        hideLabel: true,
                      }
                    : undefined
                }
                trailing={
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active.stopOnFailure}
                    disabled={runningHere}
                    onClick={() =>
                      store().updateHttpPipeline(active.id, {
                        stopOnFailure: !active.stopOnFailure,
                      })
                    }
                    title={t('httpWorkspace.pipeline.stopOnFailure')}
                    data-testid="http-pipeline-stop-on-failure"
                    className="pipeline-switch focus-ring flex items-center gap-2 rounded-md px-1 py-0.5 text-body-sm text-fg-muted"
                  >
                    <span className="switch-track" aria-hidden />
                    {t('httpWorkspace.pipeline.stopAfterFailure')}
                  </button>
                }
              />
              <p role="status" aria-live="polite" className="sr-only">
                {shownRun ? t(`httpWorkspace.pipeline.phase.${shownRun.phase}`) : ''}
              </p>

              <div className="@container min-h-0 flex-1 overflow-y-auto">
                <ol data-testid="http-pipeline-steps">
                  {active.steps.length === 0 ? (
                    <li className="px-5 py-6 text-center text-body-sm text-fg-subtle">
                      {t('httpWorkspace.pipeline.noSteps')}
                    </li>
                  ) : null}
                  {stepRows.map(({ step, request, captured }, index) => (
                    <HttpPipelineStepRow
                      key={step.id}
                      index={index}
                      count={active.steps.length}
                      enabled={step.enabled}
                      request={request}
                      result={resultByStep.get(step.id)}
                      running={isRunning && shownRun?.activeStepId === step.id}
                      stoppedAt={halt?.key === 'stoppedAt' ? halt.index : null}
                      maxMs={summary?.maxMs ?? 0}
                      locked={isRunning}
                      captured={captured}
                      onToggle={enabled =>
                        updateSteps(active.steps.map(entry => (entry.id === step.id ? { ...entry, enabled } : entry)))
                      }
                      onMove={offset => {
                        const next = active.steps.slice();
                        const target = index + offset;
                        [next[index], next[target]] = [next[target]!, next[index]!];
                        updateSteps(next);
                      }}
                      onRemove={() => updateSteps(active.steps.filter(entry => entry.id !== step.id))}
                    />
                  ))}
                </ol>
                <div className="pipeline-footer">
                  <label className="pipeline-add">
                    <Plus size={13} aria-hidden="true" />
                    <span aria-hidden>{t('httpWorkspace.pipeline.addStep')}</span>
                    <select
                      value=""
                      disabled={runningHere || active.steps.length >= HTTP_PIPELINE_MAX_STEPS}
                      onChange={event => {
                        const requestId = event.target.value;
                        if (!requestId) return;
                        updateSteps([
                          ...active.steps,
                          { id: crypto.randomUUID(), requestId, enabled: true },
                        ]);
                      }}
                      aria-label={t('httpWorkspace.pipeline.addStep')}
                      data-testid="http-pipeline-add-step"
                      className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    >
                      <option value="">{t('httpWorkspace.pipeline.addStep')}</option>
                      {requests
                        .filter(request => (request.transport ?? 'http') === 'http')
                        .map(request => (
                          <option key={request.id} value={request.id}>
                            {requestLabel(request)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <span>{t('httpWorkspace.pipeline.footer')}</span>
                </div>
              </div>
            </section>
          )}
        </div>
        <footer className="pipeline-statusbar" aria-label={t('httpWorkspace.environment.selector.label')}>
          <span data-testid="http-pipeline-environment" className="truncate" title={host ?? undefined}>
            {host ? `${environmentName} · ${host}` : environmentName}
          </span>
        </footer>
      </div>
    </OverlayBackdrop>
  );
}
