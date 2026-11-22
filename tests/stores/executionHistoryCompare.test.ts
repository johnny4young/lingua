import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockTier = 'pro';
vi.mock('@/stores/licenseSelectors', () => ({ currentEffectiveTier: () => mockTier }));

import { CAPSULE_LRU_CAP_PRO, useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RunCapsuleV1 } from '@/../shared/runCapsule';

function capsule(code = 'let a = 1;'): RunCapsuleV1 {
  return {
    tab: { name: 'a.js', language: 'javascript', runtimeMode: 'worker', workflowMode: 'run' },
    source: { content: code },
    result: { status: 'success', durationMs: 1, stdout: 'ok' },
  } as unknown as RunCapsuleV1;
}

const record = (code?: string, summary?: Parameters<ReturnType<typeof useExecutionHistoryStore.getState>['record']>[0]['summary']) =>
  useExecutionHistoryStore.getState().record({ language: 'javascript', status: 'ok', durationMs: 1, lastCapsule: capsule(code), summary });

const initial = useExecutionHistoryStore.getState();
const initialSettings = useSettingsStore.getState();

beforeEach(() => {
  mockTier = 'pro';
  useExecutionHistoryStore.setState(initial, true);
  useSettingsStore.setState({ executionHistorySnapshotEnabled: true });
});

afterEach(() => {
  useExecutionHistoryStore.setState(initial, true);
  useSettingsStore.setState(initialSettings, true);
});

describe('execution history for Compare runs', () => {
  it('keeps compare data only on a tier that keeps history', () => {
    expect(record('one', { kind: 'rows', count: 2, columns: ['id'] }).runCompare).toMatchObject({
      code: 'one', stdout: 'ok', summary: { kind: 'rows', count: 2, columns: ['id'] },
    });
    mockTier = 'free';
    expect(record('three').runCompare).toBeUndefined();
  });

  it('keeps the row count or status line of a run with a capsule on every tier and capture setting', () => {
    useSettingsStore.setState({ executionHistorySnapshotEnabled: false });
    mockTier = 'free';
    expect(record('one', { kind: 'rows', count: 2, columns: ['id'] }).resultSummary).toEqual({ kind: 'rows', count: 2, columns: ['id'] });
    expect(record('two', { kind: 'http', method: 'GET', status: 404, statusText: 'Not Found', bytes: 9 }).resultSummary).toMatchObject({
      kind: 'http', status: 404, statusText: 'Not Found',
    });
    expect(record('three').resultSummary).toBeUndefined();
    expect(useExecutionHistoryStore.getState().record({ language: 'sql', status: 'ok', durationMs: 1, summary: { kind: 'rows', count: 1, columns: [] } }).resultSummary).toBeUndefined();
  });

  it('keeps no compare data with code capture off', () => {
    useSettingsStore.setState({ executionHistorySnapshotEnabled: false });
    expect(record('one').runCompare).toBeUndefined();
  });

  it('keeps compare data after the capsule cap strips older capsules', () => {
    const first = record('first');
    for (let i = 0; i < CAPSULE_LRU_CAP_PRO; i += 1) record(`run ${i}`);
    const kept = useExecutionHistoryStore.getState().entries.find(entry => entry.id === first.id)!;
    expect(kept.lastCapsule).toBeUndefined();
    expect(kept.runCompare?.code).toBe('first');
  });

  it('drops the compare record with its capsule and brings both back on undo', () => {
    const entry = record('secret code');
    const capsule = entry.lastCapsule!;
    const find = () => useExecutionHistoryStore.getState().entries.find(item => item.id === entry.id)!;
    useExecutionHistoryStore.getState().clearCapsule(entry.id);
    expect(find().lastCapsule).toBeUndefined();
    expect(find().runCompare).toBeUndefined();
    useExecutionHistoryStore.getState().restoreCapsule(entry.id, capsule, entry.runCompare);
    expect(find().runCompare?.code).toBe('secret code');
  });

  it('drops the result summary with its capsule, brings it back on undo and clears it with captured data', () => {
    const entry = record('select 1', { kind: 'rows', count: 1, columns: ['secret_column'] });
    const find = () => useExecutionHistoryStore.getState().entries.find(item => item.id === entry.id)!;
    useExecutionHistoryStore.getState().clearCapsule(entry.id);
    expect(find().resultSummary).toBeUndefined();
    useExecutionHistoryStore.getState().restoreCapsule(entry.id, entry.lastCapsule!, entry.runCompare, entry.resultSummary);
    expect(find().resultSummary).toEqual({ kind: 'rows', count: 1, columns: ['secret_column'] });
    useExecutionHistoryStore.getState().clearCapturedData();
    expect(find().resultSummary).toBeUndefined();
  });

  it('clears every capsule, compare record and code snapshot but keeps the run rows', () => {
    record('one');
    useExecutionHistoryStore.getState().record({
      language: 'javascript', status: 'ok', durationMs: 1, snapshot: { code: 'snap', language: 'javascript' },
    });
    useExecutionHistoryStore.getState().clearCapturedData();
    const entries = useExecutionHistoryStore.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries.every(item => !item.lastCapsule && !item.runCompare && item.snapshot === null)).toBe(true);
  });
});
