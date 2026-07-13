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

import { PlayCircle, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useUtilityPipelineStore } from '../../stores/utilityPipelineStore';
import { useUIStore } from '../../stores/uiStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useAnnounce } from '../../hooks/useAnnounce';
import { useUtilityPipelineRun } from '../../hooks/useUtilityPipelineRun';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import {
  PIPELINE_MAX_STEPS,
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
import { UtilityPipelineLibrarySidebar } from './UtilityPipelineLibrarySidebar';
import { UtilityPipelineResults } from './UtilityPipelineResults';
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
  const announce = useAnnounce();
  // UX Sweep T10 — register a keyboard sensor so steps can be reordered with
  // the keyboard (focus the grip, Space to lift, Arrow Up/Down to move, Space
  // to drop, Esc to cancel), not just with a pointer drag.
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const pipelines = useUtilityPipelineStore(state => state.pipelines);
  const activePipelineId = useUtilityPipelineStore(state => state.activePipelineId);
  const isExecuting = useUtilityPipelineStore(state => state.isExecutingActive);
  const inputsByPipelineId = useUtilityPipelineStore(state => state.inputsByPipelineId);

  const activePipeline: UtilityPipelineV1 | undefined = useMemo(
    () => pipelines.find(p => p.id === activePipelineId),
    [pipelines, activePipelineId]
  );
  const activeInput = activePipelineId ? (inputsByPipelineId[activePipelineId] ?? '') : '';

  const { state: runState, run, reset: resetRun } = useUtilityPipelineRun();
  const [capsuleRunSnapshot, setCapsuleRunSnapshot] = useState<CapsuleRunSnapshot | null>(null);
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
        // UX Sweep T4 — announce the run result to screen readers; the
        // streaming result table conveys it to sighted users only.
        const okCount = outcome.results.filter((result) => result.status === 'ok').length;
        announce(
          t('utilityPipeline.run.announce', {
            ok: okCount,
            count: outcome.results.length,
          })
        );
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
  }, [activePipeline, activeInput, run, t, announce]);

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

  return (
    <div
      data-testid="utility-pipeline-panel"
      className="grid h-full min-h-[42rem] grid-cols-1 gap-4 xl:min-h-0 xl:grid-cols-[240px_minmax(22rem,0.85fr)_minmax(28rem,1.15fr)] 2xl:grid-cols-[260px_minmax(24rem,0.8fr)_minmax(36rem,1.35fr)]"
    >
      <UtilityPipelineLibrarySidebar />

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
                className="focus-ring ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-caption font-medium text-muted hover:border-border-strong hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
                className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-success-border bg-success-bg px-2 text-caption font-medium text-success-fg hover:border-success-fg disabled:cursor-not-allowed disabled:opacity-50"
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
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

      <UtilityPipelineResults
        runState={runState}
        canSaveCapsule={canSaveCapsule}
        onSaveCapsule={handleSaveCapsule}
      />
    </div>
  );
}

function statusOrPending(result: PipelineStepResult | undefined): PipelineStepStatus | null {
  return result ? result.status : null;
}
