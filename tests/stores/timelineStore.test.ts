import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockTier = 'pro';
vi.mock('@/stores/licenseSelectors', () => ({ currentEffectiveTier: () => mockTier }));

import { TIMELINE_FREE_STEPS, type TimelineStep } from '@/../shared/timeline';
import { useTimelineStore } from '@/stores/timelineStore';
import { useEditorStore } from '@/stores/editorStore';

const steps = (count: number): TimelineStep[] =>
  Array.from({ length: count }, (_, index) => ({ line: index + 1, frames: [{ name: '<module>', line: index + 1 }], vars: [] }));

beforeEach(() => {
  mockTier = 'pro';
});

afterEach(() => {
  useTimelineStore.setState({ recording: null, current: 0 });
});

describe('timeline store', () => {
  it('keeps every step for paid tiers and opens on the last one', () => {
    useTimelineStore.getState().publish('t1', { steps: steps(50), truncated: false });
    expect(useTimelineStore.getState().recording).toMatchObject({ tabId: 't1', total: 50, limited: false });
    expect(useTimelineStore.getState().current).toBe(49);
  });

  it('keeps only the last steps on Free', () => {
    mockTier = 'free';
    useTimelineStore.getState().publish('t1', { steps: steps(50), truncated: true });
    const recording = useTimelineStore.getState().recording!;
    expect(recording.steps).toHaveLength(TIMELINE_FREE_STEPS);
    expect(recording.steps[0]!.line).toBe(31);
    expect(recording).toMatchObject({ total: 50, limited: true, truncated: true });
  });

  it('drops the recording when its tab closes', () => {
    useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: '' }] as never, 't1');
    useTimelineStore.getState().publish('t1', { steps: steps(3), truncated: false });
    useEditorStore.getState().restoreTabs([{ id: 't2', name: 'b.js', language: 'javascript', content: '' }] as never, 't2');
    expect(useTimelineStore.getState().recording).toBeNull();
    useEditorStore.getState().restoreTabs([], null);
  });

  it('moves by depth and counts moves with nowhere to go', () => {
    const deep: TimelineStep[] = [
      { line: 1, frames: [{ name: '<module>', line: 1 }], vars: [] },
      { line: 5, frames: [{ name: '<module>', line: 1 }, { name: 'f', line: 5 }], vars: [] },
      { line: 2, frames: [{ name: '<module>', line: 2 }], vars: [] },
    ];
    useTimelineStore.getState().publish('t1', { steps: deep, truncated: false });
    useTimelineStore.getState().select(0);
    expect(useTimelineStore.getState().go('over', false)).toBe(true);
    expect(useTimelineStore.getState().current).toBe(2);
    expect(useTimelineStore.getState().go('out', false)).toBe(false);
    expect(useTimelineStore.getState()).toMatchObject({ current: 2, blocked: 1 });
  });

  it('keeps the selection inside the recording and clears only its own tab', () => {
    useTimelineStore.getState().publish('t1', { steps: steps(3), truncated: false });
    useTimelineStore.getState().step(5);
    expect(useTimelineStore.getState().current).toBe(2);
    useTimelineStore.getState().select(-4);
    expect(useTimelineStore.getState().current).toBe(0);
    useTimelineStore.getState().clearTab('other');
    expect(useTimelineStore.getState().recording).not.toBeNull();
    useTimelineStore.getState().clearTab('t1');
    expect(useTimelineStore.getState().recording).toBeNull();
  });
});
