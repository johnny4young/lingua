/**
 * utilityPipelineStore tests.
 *
 * CRUD + LRU + import/export + sanitize-on-rehydrate (via reset).
 * Mirror coverage of `tests/stores/workspaceSqlStore.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetUtilityPipelineStoreForTests,
  useUtilityPipelineStore,
} from '../../src/renderer/stores/utilityPipelineStore';
import { sendOutputToNewPipeline } from '../../src/renderer/stores/utilityPipelineSend';
import { PIPELINE_CAP, createBlankPipeline, createBlankStep } from '../../src/shared/utilityPipeline';

beforeEach(() => {
  localStorage.clear();
  resetUtilityPipelineStoreForTests();
});

describe('useUtilityPipelineStore', () => {
  it('starts empty', () => {
    const state = useUtilityPipelineStore.getState();
    expect(state.pipelines).toEqual([]);
    expect(state.activePipelineId).toBeNull();
  });

  it('drops the input of a pipeline evicted at the cap', () => {
    const store = useUtilityPipelineStore.getState();
    const seed = (id: string) => createBlankPipeline({ id, name: id });
    for (let index = 0; index < PIPELINE_CAP; index += 1) store.createPipeline(seed(`p${index}`));
    store.setPipelineInput('p0', 'token');
    store.setPipelineInput('p1', 'token');
    store.createPipeline(seed('new'));
    expect(useUtilityPipelineStore.getState().inputsByPipelineId).toEqual({ p1: 'token' });
  });

  it('createPipeline prepends and sets active', () => {
    const a = createBlankPipeline({ id: 'a', name: 'first' });
    const b = createBlankPipeline({ id: 'b', name: 'second' });
    useUtilityPipelineStore.getState().createPipeline(a);
    useUtilityPipelineStore.getState().createPipeline(b);
    const state = useUtilityPipelineStore.getState();
    expect(state.pipelines.map((p) => p.id)).toEqual(['b', 'a']);
    expect(state.activePipelineId).toBe('b');
  });

  it('updatePipeline patches and bumps updatedAt', () => {
    const p = createBlankPipeline({
      id: 'a',
      name: 'name',
      now: '2026-05-26T00:00:00.000Z',
    });
    useUtilityPipelineStore.getState().createPipeline(p);
    useUtilityPipelineStore.getState().updatePipeline('a', { name: 'renamed' });
    const updated = useUtilityPipelineStore.getState().getPipeline('a');
    expect(updated?.name).toBe('renamed');
    expect(updated?.updatedAt).not.toBe('2026-05-26T00:00:00.000Z');
  });

  it('updatePipeline preserves version + id pin', () => {
    const p = createBlankPipeline({ id: 'a' });
    useUtilityPipelineStore.getState().createPipeline(p);
    useUtilityPipelineStore
      .getState()
      .updatePipeline('a', { id: 'evil', version: 99 as 1 });
    const got = useUtilityPipelineStore.getState().getPipeline('a');
    expect(got?.id).toBe('a');
    expect(got?.version).toBe(1);
  });

  it('deletePipeline shifts active id when deleting active', () => {
    useUtilityPipelineStore.getState().createPipeline(createBlankPipeline({ id: 'a' }));
    useUtilityPipelineStore.getState().createPipeline(createBlankPipeline({ id: 'b' }));
    useUtilityPipelineStore.getState().deletePipeline('b');
    const state = useUtilityPipelineStore.getState();
    expect(state.pipelines.map((p) => p.id)).toEqual(['a']);
    expect(state.activePipelineId).toBe('a');
  });

  it('duplicatePipeline clones with a fresh id', () => {
    const p = createBlankPipeline({ id: 'a', name: 'source' });
    useUtilityPipelineStore.getState().createPipeline(p);
    const newId = useUtilityPipelineStore
      .getState()
      .duplicatePipeline('a', 'a-copy', '(copy)');
    expect(newId).toBe('a-copy');
    const cloned = useUtilityPipelineStore.getState().getPipeline('a-copy');
    expect(cloned?.name).toBe('source (copy)');
    expect(useUtilityPipelineStore.getState().pipelines).toHaveLength(2);
  });

  it('exportPipelineJson round-trips through importPipelineJson', () => {
    const p = createBlankPipeline({ id: 'a', name: 'export-test' });
    useUtilityPipelineStore.getState().createPipeline(p);
    const json = useUtilityPipelineStore.getState().exportPipelineJson('a');
    expect(json).not.toBeNull();
    resetUtilityPipelineStoreForTests();
    const outcome = useUtilityPipelineStore.getState().importPipelineJson(json!);
    expect(outcome.ok).toBe(true);
    expect(useUtilityPipelineStore.getState().pipelines).toHaveLength(1);
  });

  it('freshens the top-level id when importing an existing pipeline again', () => {
    const p = createBlankPipeline({ id: 'a', name: 'export-test' });
    useUtilityPipelineStore.getState().createPipeline(p);
    const json = useUtilityPipelineStore.getState().exportPipelineJson('a');
    expect(json).not.toBeNull();

    const outcome = useUtilityPipelineStore.getState().importPipelineJson(json!);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.pipeline.id).not.toBe('a');
    expect(useUtilityPipelineStore.getState().activePipelineId).toBe(outcome.pipeline.id);
    const importedIds = useUtilityPipelineStore
      .getState()
      .pipelines.map((entry) => entry.id);
    expect(new Set(importedIds).size).toBe(2);
  });

  it('setPipelineInput stores transient input separately from the pipeline', () => {
    const p = createBlankPipeline({ id: 'a' });
    useUtilityPipelineStore.getState().createPipeline(p);
    useUtilityPipelineStore.getState().setPipelineInput('a', 'eyJhIjoxfQ==');
    expect(useUtilityPipelineStore.getState().getPipelineInput('a')).toBe('eyJhIjoxfQ==');
  });

  it('importPipelineJson reports the closed reject reason on malformed JSON', () => {
    const outcome = useUtilityPipelineStore.getState().importPipelineJson('not-json');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed-json');
  });

  it('leaves the saved library, selection and input unchanged after a malformed-step import', () => {
    const existing = createBlankPipeline({ id: 'existing', name: 'Saved recipe' });
    useUtilityPipelineStore.getState().createPipeline(existing);
    useUtilityPipelineStore.getState().setPipelineInput(existing.id, 'keep this input');
    const before = useUtilityPipelineStore.getState();
    const persistedBefore = localStorage.getItem('lingua-utility-pipeline-state');
    const broken = {
      ...createBlankPipeline({ id: 'incoming' }),
      steps: [{ id: 'broken', utilityId: 'regex-replace' }],
    };

    expect(before.importPipelineJson(JSON.stringify(broken))).toMatchObject({
      ok: false,
      reason: 'invalid-shape',
    });
    expect(useUtilityPipelineStore.getState()).toBe(before);
    expect(localStorage.getItem('lingua-utility-pipeline-state')).toBe(persistedBefore);
  });

  it('setActivePipeline resets isExecutingActive on switch', () => {
    useUtilityPipelineStore.getState().createPipeline(createBlankPipeline({ id: 'a' }));
    useUtilityPipelineStore.getState().createPipeline(createBlankPipeline({ id: 'b' }));
    useUtilityPipelineStore.getState().setIsExecutingActive(true);
    useUtilityPipelineStore.getState().setActivePipeline('a');
    expect(useUtilityPipelineStore.getState().isExecutingActive).toBe(false);
  });
});

describe('step controls and sends', () => {
  it('keeps the controls and auto-bake through a duplicate', () => {
    const source = createBlankPipeline({ id: 'p1', name: 'one' });
    source.autoBake = true;
    source.steps.push({ ...createBlankStep({ id: 's', utilityId: 'url-encode' }), disabled: true, breakpoint: true });
    useUtilityPipelineStore.getState().createPipeline(source);
    const id = useUtilityPipelineStore.getState().duplicatePipeline('p1', 'p2', 'copy')!;
    const clone = useUtilityPipelineStore.getState().pipelines.find((pipeline) => pipeline.id === id)!;
    expect(clone.autoBake).toBe(true);
    expect(clone.steps[0]).toMatchObject({ disabled: true, breakpoint: true });
  });

  it('sends an output to a new pipeline without persisting the output', () => {
    expect(sendOutputToNewPipeline('tok-SECRET', 'jwt-decode', 'JWT Debugger')).toBe(true);
    const state = useUtilityPipelineStore.getState();
    const pipeline = state.pipelines[0]!;
    expect(pipeline).toMatchObject({ name: 'JWT Debugger', steps: [{ utilityId: 'jwt-decode' }] });
    expect(state.activePipelineId).toBe(pipeline.id);
    expect(state.inputsByPipelineId[pipeline.id]).toBe('tok-SECRET');
    expect(state.pendingRunPipelineId).toBe(pipeline.id);
    const stored = localStorage.getItem('lingua-utility-pipeline-state') ?? '';
    expect(stored).toContain('jwt-decode');
    expect(stored).not.toContain('tok-SECRET');
    expect(stored).not.toContain('pendingRunPipelineId');
  });

  it('refuses a send at the library cap instead of evicting a pipeline', () => {
    for (let index = 0; index < PIPELINE_CAP; index += 1) {
      useUtilityPipelineStore.getState().createPipeline(createBlankPipeline({ id: `p${index}` }));
    }
    expect(sendOutputToNewPipeline('x', 'hash', 'Hash')).toBe(false);
    expect(useUtilityPipelineStore.getState().pipelines).toHaveLength(PIPELINE_CAP);
    expect(useUtilityPipelineStore.getState().pendingRunPipelineId).toBeNull();
  });
});
