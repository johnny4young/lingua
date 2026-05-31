/**
 * RL-099 Slice 1 — Utility Pipelines panel.
 *
 * 3-section layout inside the existing Developer Utilities overlay
 * (NOT a new top-level bottom-panel tab — the plan keeps Slice 1
 * within `<UtilityToolbar>` territory):
 *
 *   - LEFT  : pipeline list (create / select / rename / duplicate /
 *             delete / import / export).
 *   - CENTER: step editor (sortable via @dnd-kit drag handles —
 *             fold B), Add step button, Run button, input textarea.
 *   - RIGHT : streaming result table with per-step status + output.
 *
 * Wires the persisted store (`useUtilityPipelineStore`), the run
 * hook (`useUtilityPipelineRun`), and the closed-enum telemetry
 * emit (`utility.pipeline_executed` — fold F).
 */

import {
  Copy as CopyIcon,
  Download,
  PlayCircle,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useUtilityPipelineStore } from '../../stores/utilityPipelineStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useUtilityPipelineRun } from '../../hooks/useUtilityPipelineRun';
import {
  PIPELINE_MAX_STEPS,
  createBlankPipeline,
  createBlankStep,
  type PipelineStepResult,
  type PipelineStepStatus,
  type PipelineStepV1,
  type UtilityPipelineV1,
} from '../../../shared/utilityPipeline';
import {
  UTILITY_ADAPTER_IDS,
  type UtilityAdapterId,
} from '../../../shared/utilities/types';
import {
  trackUtilityPipelineExecuted,
} from '../../hooks/utilityPipelineTelemetry';
import { UtilityPipelineStepRow } from './UtilityPipelineStepRow';
import { cn } from '../../utils/cn';

const DEFAULT_FIRST_STEP_UTILITY: UtilityAdapterId = 'json-format';

export function UtilityPipelinePanel() {
  const { t } = useTranslation();
  const pipelines = useUtilityPipelineStore((state) => state.pipelines);
  const activePipelineId = useUtilityPipelineStore((state) => state.activePipelineId);
  const isExecuting = useUtilityPipelineStore((state) => state.isExecutingActive);
  const inputsByPipelineId = useUtilityPipelineStore(
    (state) => state.inputsByPipelineId
  );
  const clipboardConsent = useSettingsStore(
    (state) => state.utilitiesClipboardOnFocusConsent
  );

  const activePipeline: UtilityPipelineV1 | undefined = useMemo(
    () => pipelines.find((p) => p.id === activePipelineId),
    [pipelines, activePipelineId]
  );
  const activeInput = activePipelineId
    ? (inputsByPipelineId[activePipelineId] ?? '')
    : '';

  const { state: runState, run, reset: resetRun } = useUtilityPipelineRun();
  // Per-step result map keyed by step id so the panel can render the
  // status badge regardless of which step is rendered.
  const stepResultMap = useMemo(() => {
    const map = new Map<string, PipelineStepResult>();
    for (const result of runState.stepResults) {
      map.set(result.stepId, result);
    }
    return map;
  }, [runState.stepResults]);

  // Reset run state when active pipeline changes so we don't render
  // step results against a different pipeline's step rows.
  useEffect(() => {
    resetRun();
  }, [activePipelineId, resetRun]);

  const handleCreate = useCallback(() => {
    const blank = createBlankPipeline({
      id: crypto.randomUUID(),
      name: '',
    });
    useUtilityPipelineStore.getState().createPipeline(blank);
  }, []);

  const handleSelect = useCallback((id: string) => {
    useUtilityPipelineStore.getState().setActivePipeline(id);
  }, []);

  const handleRename = useCallback((id: string, name: string) => {
    useUtilityPipelineStore.getState().updatePipeline(id, { name });
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      const ok = window.confirm(t('utilityPipeline.list.deleteConfirm'));
      if (!ok) return;
      useUtilityPipelineStore.getState().deletePipeline(id);
    },
    [t]
  );

  const handleDuplicate = useCallback(
    (id: string) => {
      useUtilityPipelineStore
        .getState()
        .duplicatePipeline(id, crypto.randomUUID(), t('utilityPipeline.list.copySuffix'));
    },
    [t]
  );

  const handleStepsPatch = useCallback(
    (nextSteps: PipelineStepV1[]) => {
      if (!activePipeline) return;
      useUtilityPipelineStore
        .getState()
        .updatePipeline(activePipeline.id, { steps: nextSteps });
    },
    [activePipeline]
  );

  const handleAddStep = useCallback(() => {
    if (!activePipeline) return;
    if (activePipeline.steps.length >= PIPELINE_MAX_STEPS) {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'utilityPipeline.editor.maxStepsReached',
        values: { max: PIPELINE_MAX_STEPS },
      });
      return;
    }
    const newStep = createBlankStep({
      id: crypto.randomUUID(),
      utilityId:
        activePipeline.steps.length === 0
          ? DEFAULT_FIRST_STEP_UTILITY
          : (UTILITY_ADAPTER_IDS[0] ?? 'json-format'),
    });
    handleStepsPatch([...activePipeline.steps, newStep]);
  }, [activePipeline, handleStepsPatch]);

  const handleStepUtilityChange = useCallback(
    (stepId: string, utilityId: UtilityAdapterId) => {
      if (!activePipeline) return;
      const next = activePipeline.steps.map((step) =>
        step.id === stepId
          ? createBlankStep({ id: step.id, utilityId })
          : step
      );
      handleStepsPatch(next);
    },
    [activePipeline, handleStepsPatch]
  );

  const handleStepOptionsChange = useCallback(
    (stepId: string, nextOptions: Record<string, unknown>) => {
      if (!activePipeline) return;
      const next = activePipeline.steps.map((step) =>
        step.id === stepId ? { ...step, options: nextOptions } : step
      );
      handleStepsPatch(next);
    },
    [activePipeline, handleStepsPatch]
  );

  const handleStepDelete = useCallback(
    (stepId: string) => {
      if (!activePipeline) return;
      const next = activePipeline.steps.filter((step) => step.id !== stepId);
      handleStepsPatch(next);
    },
    [activePipeline, handleStepsPatch]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!activePipeline) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = activePipeline.steps.findIndex((s) => s.id === active.id);
      const newIndex = activePipeline.steps.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      handleStepsPatch(arrayMove(activePipeline.steps, oldIndex, newIndex));
    },
    [activePipeline, handleStepsPatch]
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      if (!activePipeline) return;
      useUtilityPipelineStore
        .getState()
        .setPipelineInput(activePipeline.id, event.target.value);
    },
    [activePipeline]
  );

  const handleRun = useCallback(async () => {
    if (!activePipeline) return;
    if (activePipeline.steps.length === 0) return;
    if (useUtilityPipelineStore.getState().isExecutingActive) return;
    useUtilityPipelineStore.getState().setIsExecutingActive(true);
    try {
      const outcome = await run(activePipeline, activeInput);
      if (outcome) trackUtilityPipelineExecuted(outcome);
    } finally {
      useUtilityPipelineStore.getState().setIsExecutingActive(false);
    }
  }, [activePipeline, activeInput, run]);

  // Fold G — Import-from-clipboard auto-detect (gated on the existing
  // `utilitiesClipboardOnFocusConsent` three-state from RL-069 Slice 3).
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [importTextareaValue, setImportTextareaValue] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);

  const handleImportOpen = useCallback(async () => {
    setImportOpen(true);
    setImportWarning(null);
    if (clipboardConsent === 'granted' && navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text.trim().startsWith('{') && text.includes('"version"')) {
          setImportTextareaValue(text);
        }
      } catch {
        /* fall through — user can paste manually */
      }
    }
    // Defer focus so the textarea exists.
    setTimeout(() => importTextareaRef.current?.focus(), 0);
  }, [clipboardConsent]);

  const handleImportConfirm = useCallback(() => {
    if (!importTextareaValue.trim()) return;
    const outcome = useUtilityPipelineStore
      .getState()
      .importPipelineJson(importTextareaValue);
    if (outcome.ok) {
      setImportOpen(false);
      setImportTextareaValue('');
      setImportWarning(null);
    } else {
      const detail = outcome.detail ? ` — ${outcome.detail}` : '';
      setImportWarning(
        `${t(`utilityPipeline.import.reject.${camel(outcome.reason)}`)}${detail}`
      );
    }
  }, [importTextareaValue, t]);

  const handleExport = useCallback(async () => {
    if (!activePipeline) return;
    const json = useUtilityPipelineStore
      .getState()
      .exportPipelineJson(activePipeline.id);
    if (!json) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(json);
        useUIStore.getState().pushStatusNotice({
          tone: 'success',
          messageKey: 'utilityPipeline.list.exported',
        });
        return;
      } catch {
        /* clipboard rejected — fall through to inline copy */
      }
    }
    // Fallback: show in a notice with the user copying manually.
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'utilityPipeline.list.clipboardUnavailable',
    });
  }, [activePipeline]);

  return (
    <div
      data-testid="utility-pipeline-panel"
      className="grid h-full min-h-0 grid-cols-[220px_1fr_320px] gap-3"
    >
      {/* LEFT — pipeline list */}
      <aside className="flex min-h-0 flex-col border-r border-border/60 pr-2">
        <header className="flex items-center justify-between gap-2 pb-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            {t('utilityPipeline.list.label')}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleImportOpen}
              aria-label={t('utilityPipeline.list.import')}
              title={t('utilityPipeline.list.import')}
              data-testid="utility-pipeline-list-import"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <Upload size={11} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!activePipeline}
              aria-label={t('utilityPipeline.list.export')}
              title={t('utilityPipeline.list.export')}
              data-testid="utility-pipeline-list-export"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={11} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleCreate}
              aria-label={t('utilityPipeline.list.create')}
              title={t('utilityPipeline.list.create')}
              data-testid="utility-pipeline-list-create"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <Plus size={12} aria-hidden="true" />
            </button>
          </div>
        </header>
        {pipelines.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted">
            {t('utilityPipeline.list.empty')}
          </p>
        ) : null}
        <ul role="list" className="flex-1 overflow-y-auto">
          {pipelines.map((p) => {
            const isActive = p.id === activePipelineId;
            return (
              <li
                key={p.id}
                role="button"
                tabIndex={0}
                data-testid="utility-pipeline-list-row"
                data-pipeline-id={p.id}
                data-active={isActive}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => handleSelect(p.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelect(p.id);
                  }
                }}
                className={cn(
                  'group flex items-center gap-1 rounded px-2 py-1.5 text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  isActive
                    ? 'bg-background-elevated text-foreground'
                    : 'text-muted hover:bg-surface-strong/60 hover:text-foreground'
                )}
              >
                <input
                  type="text"
                  value={p.name}
                  data-testid="utility-pipeline-list-name"
                  onChange={(event) => handleRename(p.id, event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder={t('utilityPipeline.list.renamePlaceholder')}
                  className="min-w-0 flex-1 truncate bg-transparent text-xs outline-none focus:ring-0"
                />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDuplicate(p.id);
                  }}
                  aria-label={t('utilityPipeline.list.duplicateAria', { name: p.name })}
                  data-testid="utility-pipeline-list-duplicate"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-foreground group-hover:opacity-100"
                >
                  <CopyIcon size={10} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDelete(p.id);
                  }}
                  aria-label={t('utilityPipeline.list.deleteAria', { name: p.name })}
                  data-testid="utility-pipeline-list-delete"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-rose-500 group-hover:opacity-100"
                >
                  <Trash2 size={10} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        {importOpen ? (
          <div
            data-testid="utility-pipeline-import-panel"
            className="mt-2 grid gap-2 rounded border border-border/60 bg-surface/40 p-2"
          >
            <textarea
              ref={importTextareaRef}
              value={importTextareaValue}
              onChange={(event) => setImportTextareaValue(event.target.value)}
              data-testid="utility-pipeline-import-textarea"
              placeholder={t('utilityPipeline.import.placeholder')}
              rows={4}
              className="rounded border border-border/60 bg-background px-2 py-1 font-mono text-[10px]"
            />
            {importWarning ? (
              <p
                data-testid="utility-pipeline-import-error"
                className="text-[10px] text-rose-300"
              >
                {importWarning}
              </p>
            ) : null}
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  setImportOpen(false);
                  setImportWarning(null);
                }}
                data-testid="utility-pipeline-import-cancel"
                className="inline-flex h-6 items-center rounded border border-border/60 bg-surface/40 px-2 text-[10px] text-muted hover:text-foreground"
              >
                {t('utilityPipeline.import.cancel')}
              </button>
              <button
                type="button"
                onClick={handleImportConfirm}
                disabled={!importTextareaValue.trim()}
                data-testid="utility-pipeline-import-confirm"
                className="inline-flex h-6 items-center rounded border border-accent/40 bg-accent/10 px-2 text-[10px] text-accent-fg hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('utilityPipeline.import.confirm')}
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      {/* CENTER — editor */}
      <section
        data-testid="utility-pipeline-editor"
        className="flex min-h-0 flex-col gap-2"
      >
        {!activePipeline ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <div className="text-sm font-medium">{t('utilityPipeline.empty.title')}</div>
            <div className="text-xs text-muted">
              {t('utilityPipeline.empty.body')}
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                {t('utilityPipeline.editor.stepsLabel')}
              </span>
              <button
                type="button"
                onClick={handleAddStep}
                disabled={activePipeline.steps.length >= PIPELINE_MAX_STEPS}
                data-testid="utility-pipeline-editor-add-step"
                className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-[11px] font-medium text-muted hover:border-border-strong hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={11} aria-hidden="true" />
                <span>{t('utilityPipeline.editor.addStep')}</span>
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={
                  isExecuting ||
                  activePipeline.steps.length === 0 ||
                  runState.phase === 'running'
                }
                data-testid="utility-pipeline-editor-run"
                aria-label={t('utilityPipeline.editor.run')}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-success-border bg-success-bg px-2 text-[11px] font-medium text-success-fg hover:border-success-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlayCircle size={11} aria-hidden="true" />
                <span>
                  {runState.phase === 'running'
                    ? t('utilityPipeline.editor.running')
                    : t('utilityPipeline.editor.run')}
                </span>
              </button>
            </header>

            {activePipeline.steps.length === 0 ? (
              <div className="rounded border border-dashed border-border/60 p-4 text-center text-xs text-muted">
                {t('utilityPipeline.editor.emptyPipeline')}
              </div>
            ) : (
              <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={activePipeline.steps.map((step) => step.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid gap-2">
                    {activePipeline.steps.map((step, index) => {
                      const result = stepResultMap.get(step.id);
                      return (
                        <UtilityPipelineStepRow
                          key={step.id}
                          step={step}
                          index={index}
                          status={statusOrPending(result)}
                          {...(result?.errorMessage
                            ? { errorMessage: result.errorMessage }
                            : {})}
                          onUtilityChange={handleStepUtilityChange}
                          onOptionsChange={handleStepOptionsChange}
                          onDelete={handleStepDelete}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            <div className="grid gap-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                {t('utilityPipeline.editor.inputLabel')}
              </span>
              <textarea
                value={activeInput}
                onChange={handleInputChange}
                spellCheck={false}
                data-testid="utility-pipeline-editor-input"
                placeholder={t('utilityPipeline.editor.inputPlaceholder')}
                rows={4}
                className="rounded border border-border/60 bg-background px-2 py-1 font-mono text-[11px]"
              />
            </div>
          </>
        )}
      </section>

      {/* RIGHT — streaming result table */}
      <aside
        data-testid="utility-pipeline-result"
        className="flex min-h-0 flex-col gap-2 border-l border-border/60 pl-2"
      >
        <header className="pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          {t('utilityPipeline.result.title')}
        </header>
        {runState.phase === 'idle' ? (
          <p className="text-xs text-muted">{t('utilityPipeline.result.empty')}</p>
        ) : (
          <ol className="flex-1 space-y-2 overflow-y-auto pr-1">
            {runState.stepResults.map((result, index) => (
              <li
                key={result.stepId}
                data-testid="utility-pipeline-result-row"
                data-status={result.status}
                className="grid gap-1 rounded border border-border/40 bg-surface/30 p-2"
              >
                <header className="flex items-center gap-2 text-[10px] text-muted">
                  <span className="font-bold uppercase tracking-wider">
                    {t('utilityPipeline.result.stepLabel', { index: index + 1 })}
                  </span>
                  <span className="font-mono text-foreground">{result.utilityId}</span>
                  <span className="ml-auto tabular-nums">{result.durationMs} ms</span>
                </header>
                {result.status === 'ok' && typeof result.output === 'string' ? (
                  <pre
                    data-testid="utility-pipeline-result-output"
                    className="max-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded bg-background-elevated/60 p-2 font-mono text-[10px] text-foreground"
                  >
                    {result.output.length === 0
                      ? t('utilityPipeline.result.emptyOutput')
                      : result.output}
                  </pre>
                ) : null}
                {result.status === 'error' || result.status === 'timeout' ? (
                  <p
                    data-testid="utility-pipeline-result-error"
                    className="font-mono text-[10px] text-rose-300"
                  >
                    {result.errorMessage ?? t(`utilityPipeline.result.${result.status}`)}
                  </p>
                ) : null}
                {result.status === 'skipped' ? (
                  <p className="text-[10px] text-muted">
                    {t('utilityPipeline.result.skippedHint')}
                  </p>
                ) : null}
                {result.status === 'incompatible' ? (
                  <p className="font-mono text-[10px] text-amber-300">
                    {result.errorMessage ?? t('utilityPipeline.result.incompatibleHint')}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}

function statusOrPending(result: PipelineStepResult | undefined): PipelineStepStatus | null {
  return result ? result.status : null;
}

/**
 * Convert a closed-enum reject reason ('malformed-json') to the camelCase i18n
 * suffix ('malformedJson') so the keys can be split for the human reader.
 */
function camel(value: string): string {
  return value.replace(/-([a-z])/g, (_, c) => (c as string).toUpperCase());
}
