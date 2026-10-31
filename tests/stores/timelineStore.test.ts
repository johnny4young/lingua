import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockTier = 'pro';
vi.mock('@/stores/licenseSelectors', () => ({ currentEffectiveTier: () => mockTier }));

import { TIMELINE_FREE_STEPS, type TimelineStep } from '@/../shared/timeline';
import { useTimelineStore } from '@/stores/timelineStore';

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
