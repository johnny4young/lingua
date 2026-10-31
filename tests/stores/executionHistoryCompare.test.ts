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
  useSettingsStore.setState({ featureFlags: { runCompare: true } });
});

afterEach(() => {
  useExecutionHistoryStore.setState(initial, true);
  useSettingsStore.setState(initialSettings, true);
});

describe('execution history for Compare runs', () => {
  it('keeps compare data only with the flag on and a tier that keeps history', () => {
    expect(record('one', { kind: 'rows', count: 2, columns: ['id'] }).runCompare).toMatchObject({
      code: 'one', stdout: 'ok', summary: { kind: 'rows', count: 2, columns: ['id'] },
    });
    useSettingsStore.setState({ featureFlags: {} });
    expect(record('two').runCompare).toBeUndefined();
    useSettingsStore.setState({ featureFlags: { runCompare: true } });
    mockTier = 'free';
    expect(record('three').runCompare).toBeUndefined();
  });

  it('keeps compare data after the capsule cap strips older capsules', () => {
    const first = record('first');
    for (let i = 0; i < CAPSULE_LRU_CAP_PRO; i += 1) record(`run ${i}`);
    const kept = useExecutionHistoryStore.getState().entries.find(entry => entry.id === first.id)!;
    expect(kept.lastCapsule).toBeUndefined();
    expect(kept.runCompare?.code).toBe('first');
  });

  it('lets a pinned run keep its capsule past the cap, and gives it back on unpin', () => {
    const first = record('first');
    useExecutionHistoryStore.getState().togglePin(first.id);
    for (let i = 0; i < CAPSULE_LRU_CAP_PRO; i += 1) record(`run ${i}`);
    const find = () => useExecutionHistoryStore.getState().entries.find(entry => entry.id === first.id)!;
    expect(find().lastCapsule).toBeDefined();
    expect(useExecutionHistoryStore.getState().capsuleEntries()).toHaveLength(CAPSULE_LRU_CAP_PRO + 1);
    useExecutionHistoryStore.getState().togglePin(first.id);
    expect(find().lastCapsule).toBeUndefined();
  });
});
