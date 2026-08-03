/** Accessible editor and live status surface for bounded HTTP pipelines. */

import {
  ArrowDown,
  ArrowUp,
  Copy,
  GitBranch,
  Loader2,
  Play,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HTTP_PIPELINE_MAX_STEPS,
  createBlankHttpPipeline,
  type HttpPipelineRunSnapshot,
  type HttpPipelineV1,
} from '../../../shared/httpPipeline';
import type { HttpRequestV1 } from '../../../shared/httpWorkspaceSchema';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';

interface HttpPipelineManagerProps {
  readonly onClose: () => void;
  readonly run: HttpPipelineRunSnapshot | null;
  readonly onRun: (pipeline: HttpPipelineV1) => void;
  readonly onStop: () => void;
}

export function HttpPipelineManager({
  onClose,
  run,
  onRun,
  onStop,
}: HttpPipelineManagerProps) {
  const { t } = useTranslation();
  const pipelines = useWorkspaceToolStore((state) => state.httpPipelines);
  const activeId = useWorkspaceToolStore((state) => state.activeHttpPipelineId);
  const requests = useWorkspaceToolStore((state) => state.requests);
  const active = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === activeId),
    [pipelines, activeId]
  );
  const store = useWorkspaceToolStore.getState;
  const isRunning = run?.phase === 'running';
  const resultByStep = useMemo(
    () => new Map(run?.results.map((result) => [result.stepId, result]) ?? []),
    [run]
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="http-pipeline-title"
      data-testid="http-pipeline-manager"
      className="absolute inset-4 z-30 flex min-h-0 overflow-hidden rounded-xl border border-border-strong bg-bg-base shadow-2xl"
    >
      <aside className="flex w-56 shrink-0 flex-col border-r border-border-subtle bg-bg-panel">
        <header className="flex items-center justify-between border-b border-border-subtle px-3 py-2.5">
          <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">
            {t('httpWorkspace.pipeline.library')}
          </span>
          <button
            type="button"
            onClick={create}
            aria-label={t('httpWorkspace.pipeline.create')}
            className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md border border-border-subtle"
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-1.5">
          {pipelines.length === 0 ? (
            <p className="px-2 py-3 text-body-sm text-fg-subtle">
              {t('httpWorkspace.pipeline.empty')}
            </p>
          ) : null}
          {pipelines.map((pipeline) => (
            <button
              key={pipeline.id}
              type="button"
              onClick={() => store().setActiveHttpPipeline(pipeline.id)}
              data-active={pipeline.id === activeId}
              className="focus-ring mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-body-sm data-[active=true]:bg-bg-inset"
            >
              <GitBranch size={13} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{pipeline.name}</span>
              <span className="text-caption text-fg-subtle">{pipeline.steps.length}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <h2 id="http-pipeline-title" className="panel-title flex-1">
            {t('httpWorkspace.pipeline.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('httpWorkspace.environment.manager.close')}
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        {!active ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <GitBranch className="mx-auto mb-3 text-fg-subtle" aria-hidden="true" />
              <p className="text-body text-fg-muted">{t('httpWorkspace.pipeline.empty')}</p>
              <button type="button" onClick={create} className="button-primary mt-4">
                {t('httpWorkspace.pipeline.create')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={active.name}
                onChange={(event) =>
                  store().updateHttpPipeline(active.id, { name: event.target.value })
                }
                aria-label={t('httpWorkspace.pipeline.name')}
                className="h-8 min-w-[220px] flex-1 rounded-md border border-border-subtle bg-bg-inset px-3 text-body text-fg-base"
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
                className="button-secondary h-8 px-2"
              >
                <Copy size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('httpWorkspace.pipeline.deleteConfirm'))) {
                    store().deleteHttpPipeline(active.id);
                  }
                }}
                aria-label={t('httpWorkspace.pipeline.delete')}
                className="button-secondary h-8 px-2 text-error-fg"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>

            <label className="flex items-center gap-2 text-body-sm text-fg-muted">
              <input
                type="checkbox"
                checked={active.stopOnFailure}
                onChange={(event) =>
                  store().updateHttpPipeline(active.id, {
                    stopOnFailure: event.target.checked,
                  })
                }
              />
              {t('httpWorkspace.pipeline.stopOnFailure')}
            </label>

            <div className="rounded-lg border border-border-subtle bg-bg-panel">
              <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
                <span className="text-caption font-semibold text-fg-base">
                  {t('httpWorkspace.pipeline.steps')}
                </span>
                <select
                  value=""
                  disabled={active.steps.length >= HTTP_PIPELINE_MAX_STEPS}
                  onChange={(event) => {
                    const requestId = event.target.value;
                    if (!requestId) return;
                    updateSteps([
                      ...active.steps,
                      { id: crypto.randomUUID(), requestId, enabled: true },
                    ]);
                  }}
                  aria-label={t('httpWorkspace.pipeline.addStep')}
                  className="h-7 rounded-md border border-border-subtle bg-bg-inset px-2 text-caption"
                >
                  <option value="">{t('httpWorkspace.pipeline.addStep')}</option>
                  {requests
                    .filter((request) => (request.transport ?? 'http') === 'http')
                    .map((request) => (
                      <option key={request.id} value={request.id}>
                        {requestLabel(request)}
                      </option>
                    ))}
                </select>
              </div>
              <ol className="divide-y divide-border-subtle">
                {active.steps.length === 0 ? (
                  <li className="px-3 py-5 text-center text-body-sm text-fg-subtle">
                    {t('httpWorkspace.pipeline.noSteps')}
                  </li>
                ) : null}
                {active.steps.map((step, index) => {
                  const request = requests.find((entry) => entry.id === step.requestId);
                  const result = resultByStep.get(step.id);
                  const running = run?.activeStepId === step.id && isRunning;
                  return (
                    <li key={step.id} className="flex items-center gap-2 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={(event) =>
                          updateSteps(
                            active.steps.map((entry) =>
                              entry.id === step.id
                                ? { ...entry, enabled: event.target.checked }
                                : entry
                            )
                          )
                        }
                        aria-label={t('httpWorkspace.pipeline.enableStep', {
                          index: index + 1,
                        })}
                      />
                      <span className="w-5 text-right font-mono text-caption text-fg-subtle">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-body-sm text-fg-base">
                        {requestLabel(request)}
                      </span>
                      {running ? <Loader2 size={13} className="animate-spin" /> : null}
                      {result ? (
                        <span
                          className={
                            result.status === 'passed'
                              ? 'text-caption text-success-fg'
                              : result.status === 'failed'
                                ? 'text-caption text-error-fg'
                                : 'text-caption text-fg-subtle'
                          }
                        >
                          {t(`httpWorkspace.pipeline.status.${result.status}`)}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        disabled={index === 0 || isRunning}
                        onClick={() => {
                          const next = active.steps.slice();
                          [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                          updateSteps(next);
                        }}
                        aria-label={t('httpWorkspace.pipeline.moveUp')}
                        className="focus-ring p-1 disabled:opacity-30"
                      >
                        <ArrowUp size={12} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={index === active.steps.length - 1 || isRunning}
                        onClick={() => {
                          const next = active.steps.slice();
                          [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                          updateSteps(next);
                        }}
                        aria-label={t('httpWorkspace.pipeline.moveDown')}
                        className="focus-ring p-1 disabled:opacity-30"
                      >
                        <ArrowDown size={12} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() =>
                          updateSteps(active.steps.filter((entry) => entry.id !== step.id))
                        }
                        aria-label={t('httpWorkspace.pipeline.removeStep')}
                        className="focus-ring p-1 text-error-fg disabled:opacity-30"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p role="status" aria-live="polite" className="text-body-sm text-fg-muted">
                {run ? t(`httpWorkspace.pipeline.phase.${run.phase}`) : t('httpWorkspace.pipeline.ready')}
              </p>
              {isRunning ? (
                <button type="button" onClick={onStop} className="button-secondary">
                  <Square size={13} aria-hidden="true" />
                  {t('httpWorkspace.pipeline.stop')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onRun(active)}
                  disabled={!active.steps.some((step) => step.enabled)}
                  className="button-primary"
                >
                  <Play size={13} aria-hidden="true" />
                  {t('httpWorkspace.pipeline.run')}
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
