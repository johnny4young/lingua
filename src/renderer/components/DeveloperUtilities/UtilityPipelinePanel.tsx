/**
 * RL-099 Slice 1 — Utility Pipelines panel.
 *
 * 3-section layout inside the Developer Utilities workspace. It started
 * life inside the utilities overlay, but the workspace shell now gives
 * the input editor and per-step outputs enough horizontal room:
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
  PackagePlus,
  PlayCircle,
  Plus,
  Sparkles,
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
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { useUtilityPipelineStore } from '../../stores/utilityPipelineStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUtilityPipelineRun } from '../../hooks/useUtilityPipelineRun';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import {
  PIPELINE_MAX_STEPS,
  createBlankPipeline,
  createBlankStep,
  type PipelineRunOutcome,
  type PipelineStepResult,
  type PipelineStepStatus,
  type PipelineStepV1,
  type UtilityPipelineV1,
} from '../../../shared/utilityPipeline';
import { bucketCapsuleSize, utf8ByteLength } from '../../../shared/runCapsule';
import { getBundledAppInfo } from '../../../shared/appInfo';
import { UTILITY_ADAPTER_IDS, type UtilityAdapterId } from '../../../shared/utilities/types';
import {
  instantiatePipelineTemplate,
  type PipelineTemplate,
} from '../../../shared/utilityPipelineTemplates';
import { trackUtilityPipelineExecuted } from '../../hooks/utilityPipelineTelemetry';
import { buildPipelineCapsule } from '../../runtime/pipelineCapsule';
import { UtilityPipelineStepRow } from './UtilityPipelineStepRow';
import { PipelineTemplateGallery } from './PipelineTemplateGallery';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn } from '../../utils/cn';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { trackEvent } from '../../utils/telemetry';

const DEFAULT_FIRST_STEP_UTILITY: UtilityAdapterId = 'json-format';

type CapsuleRunSnapshot = {
  pipelineId: string;
  pipelineName: string;
  steps: PipelineStepV1[];
  input: string;
  outcome: PipelineRunOutcome;
};

function clonePipelineSteps(steps: readonly PipelineStepV1[]): PipelineStepV1[] {
  return steps.map(step => ({
    ...step,
    options: { ...step.options },
  }));
}

export function UtilityPipelinePanel() {
  const { t } = useTranslation();
  const effectiveTier = useEffectiveTier();
  const canUseUtilityWorkflows = useEntitlement('DEV_UTILITIES');

  const handleUnlock = useCallback(() => {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: t('upsell.feature.utilityWorkflows'),
    });
    void trackEvent('feature.blocked', {
      entitlement: 'utility-workflows',
      tier: effectiveTier,
    });
  }, [effectiveTier, t]);

  if (!canUseUtilityWorkflows) {
    return (
      <div
        data-testid="utility-pipeline-locked"
        className="flex h-full min-h-[34rem] flex-col items-center justify-center gap-4 rounded-2xl border border-warning/30 bg-warning/5 p-8 text-center"
      >
        <span className="rounded-full border border-warning/45 bg-warning/10 px-2 py-1 font-mono text-eyebrow font-bold uppercase tracking-[0.16em] text-warning">
          {t('utilities.locked.proBadge')}
        </span>
        <div className="max-w-xl">
          <h3 className="text-h3 font-semibold text-foreground">
            {t('utilityPipeline.locked.title')}
          </h3>
          <p className="mt-2 text-body leading-6 text-muted">{t('utilityPipeline.locked.body')}</p>
        </div>
        <button
          type="button"
          data-testid="utility-pipeline-unlock"
          onClick={handleUnlock}
          className="button-primary"
        >
          {t('utilityPipeline.locked.action')}
        </button>
      </div>
    );
  }

  return <UtilityPipelinePanelUnlocked />;
}

function UtilityPipelinePanelUnlocked() {
  const { t } = useTranslation();
  const pipelines = useUtilityPipelineStore(state => state.pipelines);
  const activePipelineId = useUtilityPipelineStore(state => state.activePipelineId);
  const isExecuting = useUtilityPipelineStore(state => state.isExecutingActive);
  const inputsByPipelineId = useUtilityPipelineStore(state => state.inputsByPipelineId);
  const clipboardConsent = useSettingsStore(state => state.utilitiesClipboardOnFocusConsent);

  const activePipeline: UtilityPipelineV1 | undefined = useMemo(
    () => pipelines.find(p => p.id === activePipelineId),
    [pipelines, activePipelineId]
  );
  const activeInput = activePipelineId ? (inputsByPipelineId[activePipelineId] ?? '') : '';

  const { state: runState, run, reset: resetRun } = useUtilityPipelineRun();
  const [capsuleRunSnapshot, setCapsuleRunSnapshot] = useState<CapsuleRunSnapshot | null>(null);
  // UX Sweep T2 — id of the pipeline pending a delete confirmation.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
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

  // RL-099 Slice 5 fold B — deselect the active pipeline so the
  // empty-state template gallery shows, letting users with existing
  // pipelines browse starters too (their pipelines stay in the list).
  const handleShowTemplates = useCallback(() => {
    useUtilityPipelineStore.getState().setActivePipeline(null);
  }, []);

  // RL-099 Slice 5 — instantiate a gallery template into a fresh
  // pipeline, select it, seed the sample input (fold F), and record the
  // adoption event (fold A). Ids are minted here (the shared catalog
  // stays free of crypto), one per step.
  const handleUseTemplate = useCallback(
    (template: PipelineTemplate) => {
      const pipelineId = crypto.randomUUID();
      const stepIds = template.steps.map(() => crypto.randomUUID());
      const pipeline = instantiatePipelineTemplate(template, {
        pipelineId,
        stepIds,
        name: t(template.nameKey),
      });
      const store = useUtilityPipelineStore.getState();
      store.createPipeline(pipeline);
      store.setActivePipeline(pipeline.id);
      if (template.sampleInput.length > 0) {
        store.setPipelineInput(pipeline.id, template.sampleInput);
      }
      void trackEvent('utility.pipeline_template_used', {
        templateId: template.id,
      });
    },
    [t]
  );

  const handleRename = useCallback((id: string, name: string) => {
    useUtilityPipelineStore.getState().updatePipeline(id, { name });
  }, []);

  // UX Sweep T2 — the native `window.confirm` had no danger styling,
  // no focus management, and could not be translated mid-string; route
  // the pipeline delete through the shared ConfirmDialog instead.
  const handleDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (pendingDeleteId === null) return;
    useUtilityPipelineStore.getState().deletePipeline(pendingDeleteId);
    setPendingDeleteId(null);
  }, [pendingDeleteId]);

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
      useUtilityPipelineStore.getState().updatePipeline(activePipeline.id, { steps: nextSteps });
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
      const next = activePipeline.steps.map(step =>
        step.id === stepId ? createBlankStep({ id: step.id, utilityId }) : step
      );
      handleStepsPatch(next);
    },
    [activePipeline, handleStepsPatch]
  );

  const handleStepOptionsChange = useCallback(
    (stepId: string, nextOptions: Record<string, unknown>) => {
      if (!activePipeline) return;
      const next = activePipeline.steps.map(step =>
        step.id === stepId ? { ...step, options: nextOptions } : step
      );
      handleStepsPatch(next);
    },
    [activePipeline, handleStepsPatch]
  );

  const handleStepDelete = useCallback(
    (stepId: string) => {
      if (!activePipeline) return;
      const next = activePipeline.steps.filter(step => step.id !== stepId);
      handleStepsPatch(next);
    },
    [activePipeline, handleStepsPatch]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!activePipeline) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = activePipeline.steps.findIndex(s => s.id === active.id);
      const newIndex = activePipeline.steps.findIndex(s => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      handleStepsPatch(arrayMove(activePipeline.steps, oldIndex, newIndex));
    },
    [activePipeline, handleStepsPatch]
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      if (!activePipeline) return;
      useUtilityPipelineStore.getState().setPipelineInput(activePipeline.id, event.target.value);
    },
    [activePipeline]
  );

  const handleRun = useCallback(async () => {
    if (!activePipeline) return;
    if (activePipeline.steps.length === 0) return;
    if (useUtilityPipelineStore.getState().isExecutingActive) return;
    useUtilityPipelineStore.getState().setIsExecutingActive(true);
    const runInput = activeInput;
    const runSteps = clonePipelineSteps(activePipeline.steps);
    const runPipelineId = activePipeline.id;
    const runPipelineName = activePipeline.name;
    setCapsuleRunSnapshot(null);
    try {
      const outcome = await run(activePipeline, runInput);
      if (outcome) {
        trackUtilityPipelineExecuted(outcome);
        setCapsuleRunSnapshot({
          pipelineId: runPipelineId,
          pipelineName: runPipelineName,
          steps: runSteps,
          input: runInput,
          outcome,
        });
      }
    } finally {
      useUtilityPipelineStore.getState().setIsExecutingActive(false);
    }
  }, [activePipeline, activeInput, run]);

  // Fold A — EXPLICIT "Save run as capsule". This is deliberately NOT
  // wired into `handleRun`: a pipeline run only lands in the in-memory
  // execution-history ring (and thus the Pro browse overlay + RL-094
  // comparator) when the user asks for it. Keep a snapshot of the exact
  // run inputs so edits made after settle cannot pair a stale outcome with
  // the current recipe/input.
  const canSaveCapsule =
    runState.phase === 'settled' &&
    capsuleRunSnapshot !== null &&
    capsuleRunSnapshot.pipelineId === activePipelineId &&
    !isExecuting;

  const handleSaveCapsule = useCallback(async () => {
    if (
      runState.phase !== 'settled' ||
      capsuleRunSnapshot === null ||
      capsuleRunSnapshot.pipelineId !== activePipelineId
    ) {
      return;
    }
    const appInfo = getBundledAppInfo();
    const platform: 'web' | 'desktop' =
      typeof window !== 'undefined' && window.lingua?.platform === 'desktop'
        ? 'desktop'
        : 'web';
    let capsule;
    try {
      capsule = await buildPipelineCapsule({
        appVersion: appInfo.version,
        pipelineName: capsuleRunSnapshot.pipelineName,
        steps: capsuleRunSnapshot.steps,
        input: capsuleRunSnapshot.input,
        outcome: capsuleRunSnapshot.outcome,
        platform,
      });
    } catch {
      capsule = undefined;
    }
    if (capsule === undefined) {
      // The capsule build (pure Web Crypto + UUID) failed. Record nothing —
      // a capsule-less entry never surfaces in the Pro browse anyway — and
      // tell the user the save did not happen, rather than a misleading
      // "saved" toast on an entry that does not exist.
      useUIStore.getState().pushStatusNotice({
        tone: 'error',
        messageKey: 'pipeline.capsule.saveFailed',
      });
      return;
    }
    useExecutionHistoryStore.getState().record({
      language: 'pipeline',
      status: capsuleRunSnapshot.outcome.status === 'all-ok' ? 'ok' : 'error',
      durationMs: capsuleRunSnapshot.outcome.durationMs,
      lastCapsule: capsule,
    });
    void trackEvent('capsule.exported', {
      trigger: 'pipeline-run',
      sizeBucket: bucketCapsuleSize(utf8ByteLength(JSON.stringify(capsule))),
    });
    useUIStore.getState().pushStatusNotice({
      tone: 'success',
      messageKey: 'pipeline.capsule.saved',
    });
    // One capsule per run: clear the snapshot so the button disables after a
    // successful save. Without this, re-clicking Save records a duplicate
    // capsule of the same run (each build mints a fresh capsuleId, and
    // `record` appends). A subsequent run installs a new snapshot and
    // re-enables the button; the build-failure path above returns early and
    // leaves the snapshot intact so the user can retry.
    setCapsuleRunSnapshot(null);
  }, [activePipelineId, capsuleRunSnapshot, runState.phase]);

  // Fold G — Import-from-clipboard auto-detect (gated on the existing
  // `utilitiesClipboardOnFocusConsent` three-state from RL-069 Slice 3).
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // UX Sweep T3 — the button that opens the import panel, so focus can
  // return to it when the panel is dismissed.
  const importTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [importTextareaValue, setImportTextareaValue] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);

  // UX Sweep T3 — close the inline import panel and return focus to its
  // trigger, so a keyboard user is not stranded inside a now-gone panel.
  const closeImportPanel = useCallback(() => {
    setImportOpen(false);
    setImportWarning(null);
    importTriggerRef.current?.focus();
  }, []);

  // Escape dismisses the import panel WITHOUT bubbling to the Developer
  // Utilities overlay (which would otherwise close the whole surface).
  const handleImportKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeImportPanel();
    },
    [closeImportPanel]
  );

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
    const outcome = useUtilityPipelineStore.getState().importPipelineJson(importTextareaValue);
    if (outcome.ok) {
      setImportOpen(false);
      setImportTextareaValue('');
      setImportWarning(null);
      importTriggerRef.current?.focus();
    } else {
      const detail = outcome.detail ? ` — ${outcome.detail}` : '';
      setImportWarning(`${t(`utilityPipeline.import.reject.${camel(outcome.reason)}`)}${detail}`);
    }
  }, [importTextareaValue, t]);

  const handleExport = useCallback(async () => {
    if (!activePipeline) return;
    const json = useUtilityPipelineStore.getState().exportPipelineJson(activePipeline.id);
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
      className="grid h-full min-h-[42rem] grid-cols-1 gap-4 xl:min-h-0 xl:grid-cols-[240px_minmax(22rem,0.85fr)_minmax(28rem,1.15fr)] 2xl:grid-cols-[260px_minmax(24rem,0.8fr)_minmax(36rem,1.35fr)]"
    >
      {/* LEFT — pipeline list */}
      <aside className="flex min-h-0 flex-col border-r border-border/60 pr-2">
        <header className="flex items-center justify-between gap-2 pb-2">
          <span className="text-caption font-bold uppercase tracking-[0.12em] text-muted">
            {t('utilityPipeline.list.label')}
          </span>
          <div className="flex items-center gap-1">
            <button
              ref={importTriggerRef}
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
              onClick={handleShowTemplates}
              aria-label={t('utilityPipeline.template.galleryTitle')}
              title={t('utilityPipeline.template.galleryTitle')}
              data-testid="utility-pipeline-list-templates"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <Sparkles size={11} aria-hidden="true" />
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
          <p className="px-2 py-3 text-body-sm text-muted">{t('utilityPipeline.list.empty')}</p>
        ) : null}
        <ul role="list" className="flex-1 overflow-y-auto">
          {pipelines.map(p => {
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
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelect(p.id);
                  }
                }}
                className={cn(
                  'focus-ring group flex items-center gap-1 rounded px-2 py-1.5 text-body-sm cursor-pointer',
                  isActive
                    ? 'bg-background-elevated text-foreground'
                    : 'text-muted hover:bg-surface-strong/60 hover:text-foreground'
                )}
              >
                <input
                  type="text"
                  value={p.name}
                  data-testid="utility-pipeline-list-name"
                  onChange={event => handleRename(p.id, event.target.value)}
                  onClick={event => event.stopPropagation()}
                  onKeyDown={event => event.stopPropagation()}
                  placeholder={t('utilityPipeline.list.renamePlaceholder')}
                  className="min-w-0 flex-1 truncate bg-transparent text-body-sm outline-none focus:ring-0"
                />
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    handleDuplicate(p.id);
                  }}
                  aria-label={t('utilityPipeline.list.duplicateAria', { name: p.name })}
                  data-testid="utility-pipeline-list-duplicate"
                  className="focus-ring inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                >
                  <CopyIcon size={10} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    handleDelete(p.id);
                  }}
                  aria-label={t('utilityPipeline.list.deleteAria', { name: p.name })}
                  data-testid="utility-pipeline-list-delete"
                  className="focus-ring inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-rose-500 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
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
            onKeyDown={handleImportKeyDown}
            className="mt-2 grid gap-2 rounded border border-border/60 bg-surface/40 p-2"
          >
            <textarea
              ref={importTextareaRef}
              value={importTextareaValue}
              onChange={event => setImportTextareaValue(event.target.value)}
              data-testid="utility-pipeline-import-textarea"
              placeholder={t('utilityPipeline.import.placeholder')}
              rows={4}
              className="rounded border border-border/60 bg-background px-2 py-1 font-mono text-eyebrow"
            />
            {importWarning ? (
              <p data-testid="utility-pipeline-import-error" className="text-eyebrow text-rose-300">
                {importWarning}
              </p>
            ) : null}
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={closeImportPanel}
                data-testid="utility-pipeline-import-cancel"
                className="inline-flex h-6 items-center rounded border border-border/60 bg-surface/40 px-2 text-eyebrow text-muted hover:text-foreground"
              >
                {t('utilityPipeline.import.cancel')}
              </button>
              <button
                type="button"
                onClick={handleImportConfirm}
                disabled={!importTextareaValue.trim()}
                data-testid="utility-pipeline-import-confirm"
                className="inline-flex h-6 items-center rounded border border-accent/40 bg-accent/10 px-2 text-eyebrow text-accent-fg hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('utilityPipeline.import.confirm')}
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      {/* CENTER — editor */}
      <section data-testid="utility-pipeline-editor" className="flex min-h-0 flex-col gap-2">
        {!activePipeline ? (
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
            <div className="flex flex-col gap-1">
              <div className="text-body font-medium">{t('utilityPipeline.empty.title')}</div>
              <div className="text-body-sm text-muted">{t('utilityPipeline.empty.body')}</div>
            </div>
            {/* RL-099 Slice 5 — starter gallery so a blank pipeline panel
                is discoverable now the engine ships 15 adapters. */}
            <PipelineTemplateGallery onUseTemplate={handleUseTemplate} />
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2">
              <span className="text-caption font-bold uppercase tracking-[0.12em] text-muted">
                {t('utilityPipeline.editor.stepsLabel')}
              </span>
              <button
                type="button"
                onClick={handleAddStep}
                disabled={activePipeline.steps.length >= PIPELINE_MAX_STEPS}
                data-testid="utility-pipeline-editor-add-step"
                className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-caption font-medium text-muted hover:border-border-strong hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={11} aria-hidden="true" />
                <span>{t('utilityPipeline.editor.addStep')}</span>
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={
                  isExecuting || activePipeline.steps.length === 0 || runState.phase === 'running'
                }
                data-testid="utility-pipeline-editor-run"
                aria-label={t('utilityPipeline.editor.run')}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-success-border bg-success-bg px-2 text-caption font-medium text-success-fg hover:border-success-fg disabled:cursor-not-allowed disabled:opacity-50"
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
              <div className="rounded border border-dashed border-border/60 p-4 text-center text-body-sm text-muted">
                {t('utilityPipeline.editor.emptyPipeline')}
              </div>
            ) : (
              <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={activePipeline.steps.map(step => step.id)}
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
                          {...(result?.errorMessage ? { errorMessage: result.errorMessage } : {})}
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
              <span className="text-caption font-bold uppercase tracking-[0.12em] text-muted">
                {t('utilityPipeline.editor.inputLabel')}
              </span>
              <textarea
                value={activeInput}
                onChange={handleInputChange}
                spellCheck={false}
                data-testid="utility-pipeline-editor-input"
                placeholder={t('utilityPipeline.editor.inputPlaceholder')}
                rows={6}
                className="rounded border border-border/60 bg-background px-2 py-1 font-mono text-caption"
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
        <header className="flex items-center gap-2 pb-1">
          <span className="text-caption font-bold uppercase tracking-[0.12em] text-muted">
            {t('utilityPipeline.result.title')}
          </span>
          <button
            type="button"
            onClick={handleSaveCapsule}
            disabled={!canSaveCapsule}
            data-testid="pipeline-save-capsule"
            title={t('pipeline.capsule.saveAction')}
            className="ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-eyebrow font-medium text-muted hover:border-border-strong hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
                  <p className="text-eyebrow text-muted">
                    {t('utilityPipeline.result.skippedHint')}
                  </p>
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

      {pendingDeleteId !== null ? (
        <ConfirmDialog
          testId="utility-pipeline-delete-confirm"
          title={t('utilityPipeline.list.deleteConfirm.title')}
          body={t('utilityPipeline.list.deleteConfirm.body', {
            name: pipelines.find((p) => p.id === pendingDeleteId)?.name ?? '',
          })}
          confirmLabel={t('utilityPipeline.list.deleteConfirm.confirm')}
          cancelLabel={t('utilityPipeline.list.deleteConfirm.cancel')}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDeleteId(null)}
        />
      ) : null}
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
