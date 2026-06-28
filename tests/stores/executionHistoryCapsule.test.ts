/**
 * RL-094 Slice 3 — capsule browse store surface.
 *
 * Pins the `capsuleEntries()` selector (newest-first, capsule-only),
 * the `clearCapsule()` action (fold B — drop the capsule, keep the
 * run row), and the tier-aware LRU cap (fold A — Free keeps
 * `CAPSULE_LRU_CAP`, paid tiers keep `CAPSULE_LRU_CAP_PRO`).
 *
 * `currentEffectiveTier` is mocked so the cap can be exercised on both
 * tiers without minting a real license token; `isEntitled` stays the
 * real policy from `src/shared/entitlements.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockTier = 'free';
vi.mock('@/hooks/useEntitlement', () => ({
  currentEffectiveTier: () => mockTier,
}));

import {
  CAPSULE_LRU_CAP,
  CAPSULE_LRU_CAP_PRO,
  useExecutionHistoryStore,
} from '@/stores/executionHistoryStore';
import type { RunCapsuleV1 } from '@/../shared/runCapsule';

function makeCapsule(language = 'javascript'): RunCapsuleV1 {
  // Minimal shape — the store only checks `lastCapsule !== undefined`
  // and reads `tab.language`; it never re-validates the schema.
  return {
    version: 1,
    tab: { language },
  } as unknown as RunCapsuleV1;
}

function recordCapsule(language = 'javascript', status: 'ok' | 'error' = 'ok') {
  return useExecutionHistoryStore.getState().record({
    language,
    status,
    durationMs: 1,
    lastCapsule: makeCapsule(language),
  });
}

const initial = useExecutionHistoryStore.getState();

beforeEach(() => {
  mockTier = 'free';
  useExecutionHistoryStore.setState(initial, true);
});

afterEach(() => {
  useExecutionHistoryStore.setState(initial, true);
});

describe('executionHistoryStore — capsule browse surface (RL-094 Slice 3)', () => {
  it('capsuleEntries returns only entries with a capsule, newest first', () => {
    recordCapsule('javascript');
    useExecutionHistoryStore.getState().record({
      language: 'python',
      status: 'ok',
      durationMs: 2,
    }); // no capsule
    recordCapsule('typescript');

    const entries = useExecutionHistoryStore.getState().capsuleEntries();
    expect(entries).toHaveLength(2);
    // Newest first: typescript before javascript; the capsule-less
    // python run is excluded.
    expect(entries[0]!.language).toBe('typescript');
    expect(entries[1]!.language).toBe('javascript');
    expect(entries.every((entry) => entry.lastCapsule !== undefined)).toBe(true);
  });

  it('clearCapsule drops the capsule but keeps the run row (fold B)', () => {
    const first = recordCapsule('javascript');
    recordCapsule('typescript');

    useExecutionHistoryStore.getState().clearCapsule(first.id);

    const entries = useExecutionHistoryStore.getState().entries;
    // The run row survives…
    expect(entries).toHaveLength(2);
    const target = entries.find((entry) => entry.id === first.id);
    expect(target).toBeDefined();
    // …but its capsule is gone.
    expect(target!.lastCapsule).toBeUndefined();
    // The other capsule is untouched.
    expect(
      useExecutionHistoryStore.getState().capsuleEntries()
    ).toHaveLength(1);
  });

  it('clearCapsule is a no-op for an unknown id or a capsule-less row', () => {
    recordCapsule('javascript');
    const before = useExecutionHistoryStore.getState().entries;
    useExecutionHistoryStore.getState().clearCapsule('does-not-exist');
    expect(useExecutionHistoryStore.getState().entries).toBe(before);
  });

  // UX Sweep T2 fold E — restoreCapsule backs the capsule-delete undo.
  it('restoreCapsule re-attaches a cleared capsule to the same run row', () => {
    const first = recordCapsule('javascript');
    recordCapsule('typescript');

    const removed = first.lastCapsule!;
    useExecutionHistoryStore.getState().clearCapsule(first.id);
    expect(
      useExecutionHistoryStore.getState().capsuleEntries()
    ).toHaveLength(1);

    useExecutionHistoryStore.getState().restoreCapsule(first.id, removed);
    const entries = useExecutionHistoryStore.getState().capsuleEntries();
    expect(entries).toHaveLength(2);
    const target = entries.find((entry) => entry.id === first.id);
    expect(target?.lastCapsule).toBe(removed);
  });

  it('restoreCapsule is a no-op when the row already has a capsule', () => {
    const first = recordCapsule('javascript');
    const before = useExecutionHistoryStore.getState().entries;
    // The row still has its capsule — restore must not replace it.
    useExecutionHistoryStore
      .getState()
      .restoreCapsule(first.id, makeCapsule('python'));
    expect(useExecutionHistoryStore.getState().entries).toBe(before);
  });

  it('restoreCapsule reapplies the tier-aware LRU cap', () => {
    const removedEntry = recordCapsule('javascript');
    const removedCapsule = removedEntry.lastCapsule!;
    useExecutionHistoryStore.getState().clearCapsule(removedEntry.id);

    for (let i = 0; i < CAPSULE_LRU_CAP; i += 1) {
      recordCapsule(`new-${i}`);
    }
    expect(
      useExecutionHistoryStore.getState().capsuleEntries()
    ).toHaveLength(CAPSULE_LRU_CAP);

    useExecutionHistoryStore
      .getState()
      .restoreCapsule(removedEntry.id, removedCapsule);

    const state = useExecutionHistoryStore.getState();
    expect(state.capsuleEntries()).toHaveLength(CAPSULE_LRU_CAP);
    expect(
      state.entries.find((entry) => entry.id === removedEntry.id)?.lastCapsule
    ).toBeUndefined();
  });

  it('Free tier retains only CAPSULE_LRU_CAP capsules (fold A)', () => {
    mockTier = 'free';
    for (let i = 0; i < CAPSULE_LRU_CAP + 3; i += 1) {
      recordCapsule('javascript');
    }
    expect(
      useExecutionHistoryStore.getState().capsuleEntries()
    ).toHaveLength(CAPSULE_LRU_CAP);
  });

  it('paid tiers retain up to CAPSULE_LRU_CAP_PRO capsules (fold A)', () => {
    mockTier = 'pro';
    for (let i = 0; i < CAPSULE_LRU_CAP_PRO + 3; i += 1) {
      recordCapsule('javascript');
    }
    expect(
      useExecutionHistoryStore.getState().capsuleEntries()
    ).toHaveLength(CAPSULE_LRU_CAP_PRO);
  });

  it('CAPSULE_LRU_CAP_PRO is strictly larger than the Free cap', () => {
    expect(CAPSULE_LRU_CAP_PRO).toBeGreaterThan(CAPSULE_LRU_CAP);
  });
});
