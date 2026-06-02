/**
 * RL-123 / AUDIT-03 — console de-render budget (Slice 1).
 *
 * Locks the store-side work the console used to pay on every render: the
 * consecutive-identical collapse plus the stable equality hash now run once
 * per push (`consoleStore.addEntry`), not per render. This bench pushes a
 * 500-entry session — distinct rows interleaved with short duplicate runs — and
 * asserts the collapse + hash stays well under budget, so a regression that
 * re-introduces per-render `JSON.stringify` equality (or an O(n^2) collapse)
 * trips the gate.
 *
 * NOTE: the AC's < 16 ms paint budget for a 500-entry session depends on the
 * list windower, which lands in RL-123 Slice 2 (hand-rolled virtualization).
 * This Slice-1 bench locks the de-render work the windower will build on.
 *
 * CI gets a 1.5x multiplier per the pattern in `consoleOutputBadge.bench.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { useConsoleStore } from '@/stores/consoleStore';

const IS_CI = process.env.CI === 'true';
const CI_MULTIPLIER = 1.5;

function budget(ms: number): number {
  return IS_CI ? Math.round(ms * CI_MULTIPLIER) : ms;
}

function resetStore(): void {
  useConsoleStore.setState({
    entries: [],
    collapsedEntries: [],
    activeFilters: new Set(['log', 'info', 'warn', 'error', 'result']),
    hiddenPayloadKinds: new Set(),
    showTimestamps: true,
  });
}

describe('console store-side collapse + hash — 500 entries (RL-123 / AUDIT-03)', () => {
  it('collapses + hashes a 500-entry session within budget', () => {
    resetStore();
    const { addEntry } = useConsoleStore.getState();

    const start = performance.now();
    for (let i = 0; i < 500; i += 1) {
      // Runs of 3 identical rows then a new value: exercises both the
      // repeat-count increment path and the new-row path.
      addEntry({ type: 'log', content: `line ${Math.floor(i / 3)}` });
    }
    const elapsed = performance.now() - start;

    const { entries, collapsedEntries } = useConsoleStore.getState();
    // Raw entries are all retained…
    expect(entries).toHaveLength(500);
    // …and collapse into one row per 3-entry run (167 groups for 500 rows).
    expect(collapsedEntries).toHaveLength(167);
    expect(collapsedEntries[0]!.repeatCount).toBe(3);
    expect(elapsed).toBeLessThan(budget(200));
  });
});
