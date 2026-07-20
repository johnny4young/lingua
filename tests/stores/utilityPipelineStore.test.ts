/**
 * implementation — utilityPipelineStore tests.
 *
 * CRUD + LRU + import/export + sanitize-on-rehydrate (via reset).
 * Mirror coverage of `tests/stores/workspaceSqlStore.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetUtilityPipelineStoreForTests,
  useUtilityPipelineStore,
} from '../../src/renderer/stores/utilityPipelineStore';
import { createBlankPipeline } from '../../src/shared/utilityPipeline';

beforeEach(() => {
  resetUtilityPipelineStoreForTests();
});

describe('useUtilityPipelineStore', () => {
  it('starts empty', () => {
    const state = useUtilityPipelineStore.getState();
    expect(state.pipelines).toEqual([]);
    expect(state.activePipelineId).toBeNull();
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

  it('setActivePipeline resets isExecutingActive on switch', () => {
    useUtilityPipelineStore.getState().createPipeline(createBlankPipeline({ id: 'a' }));
    useUtilityPipelineStore.getState().createPipeline(createBlankPipeline({ id: 'b' }));
    useUtilityPipelineStore.getState().setIsExecutingActive(true);
    useUtilityPipelineStore.getState().setActivePipeline('a');
    expect(useUtilityPipelineStore.getState().isExecutingActive).toBe(false);
  });
});
