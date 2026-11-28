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

  it('grows a recording in flight, follows its last step and lets the final timeline replace it', () => {
    const store = useTimelineStore.getState();
    store.grow('t1', steps(3), 30, 'code');
    expect(useTimelineStore.getState().recording).toMatchObject({ tabId: 't1', total: 3, live: true, ms: 30, code: 'code' });
    expect(useTimelineStore.getState().current).toBe(2);
    store.grow('t1', steps(2), 60, 'later');
    expect(useTimelineStore.getState().recording).toMatchObject({ total: 5, ms: 60, code: 'code' });
    expect(useTimelineStore.getState().current).toBe(4);
    // A step the user picked stays picked.
    store.select(1);
    store.grow('t1', steps(1), 70);
    expect(useTimelineStore.getState().current).toBe(1);
    store.publish('t1', { steps: steps(6), truncated: false, ms: 80 });
    expect(useTimelineStore.getState().recording).not.toHaveProperty('live');
    expect(useTimelineStore.getState().current).toBe(5);
  });

  it('keeps a recording in flight when another tab posts steps at the same time', () => {
    const store = useTimelineStore.getState();
    store.grow('t1', steps(3), 30);
    store.grow('t2', steps(1), 10);
    expect(useTimelineStore.getState().recording).toMatchObject({ tabId: 't1', total: 3 });
    store.publish('t1', { steps: steps(4), truncated: false });
    store.grow('t2', steps(1), 10);
    expect(useTimelineStore.getState().recording).toMatchObject({ tabId: 't2', total: 1, live: true });
  });

  it('keeps the last steps of a recording in flight on Free', () => {
    mockTier = 'free';
    useTimelineStore.getState().grow('t1', steps(15), 10);
    useTimelineStore.getState().grow('t1', steps(15), 20);
    const recording = useTimelineStore.getState().recording!;
    expect(recording.steps).toHaveLength(TIMELINE_FREE_STEPS);
    expect(recording).toMatchObject({ total: 30, limited: true, entitled: false });
    expect(useTimelineStore.getState().current).toBe(TIMELINE_FREE_STEPS - 1);
  });

  it('keeps a recording in flight as cut short, or drops it, when the run ends without its timeline', () => {
    const store = useTimelineStore.getState();
    store.grow('t1', steps(3), 30);
    store.endLive('t2', true);
    expect(useTimelineStore.getState().recording?.live).toBe(true);
    store.endLive('t1', true);
    expect(useTimelineStore.getState().recording).toMatchObject({ truncated: true, total: 3 });
    expect(useTimelineStore.getState().recording).not.toHaveProperty('live');
    // A finished recording is not touched.
    store.endLive('t1', false);
    expect(useTimelineStore.getState().recording).not.toBeNull();
    store.grow('t1', steps(2), 10);
    store.endLive('t1', false);
    expect(useTimelineStore.getState().recording).toBeNull();
  });

  it('applies the marks a batch carries to the step the previous batch ended on', () => {
    const store = useTimelineStore.getState();
    // Marks with no recording in flight have nowhere to go.
    store.grow('t1', [], 5, '', { log: 'warn' });
    expect(useTimelineStore.getState().recording).toBeNull();
    store.grow('t1', steps(2), 10);
    store.grow('t1', [], 20, '', { log: 'log' });
    // The worker sends the step's marks as they stand now, so they replace the earlier ones.
    store.grow('t1', steps(1), 30, '', { log: 'warn', error: true });
    const recorded = useTimelineStore.getState().recording!.steps;
    expect(recorded.map(step => [step.log, step.error])).toEqual([
      [undefined, undefined],
      ['warn', true],
      [undefined, undefined],
    ]);
  });

  it('marks the latest step on the line a crashed run threw on, and none when no step reached it', () => {
    const store = useTimelineStore.getState();
    store.grow('t1', [...steps(2), ...steps(2)], 10);
    store.endLive('t1', true, 1);
    expect(useTimelineStore.getState().recording?.steps.map(step => step.error)).toEqual([undefined, undefined, true, undefined]);
    store.grow('t1', steps(2), 10);
    store.endLive('t1', true, 9);
    expect(useTimelineStore.getState().recording?.steps.some(step => step.error)).toBe(false);
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

  it('counts a page move from the first or last step as blocked, but not a partial one', () => {
    useTimelineStore.getState().publish('t1', { steps: steps(3), truncated: false });
    const before = useTimelineStore.getState().blocked;
    expect(useTimelineStore.getState().step(10)).toBe(false);
    expect(useTimelineStore.getState().blocked).toBe(before + 1);
    expect(useTimelineStore.getState().step(-10)).toBe(true);
    expect(useTimelineStore.getState().current).toBe(0);
    expect(useTimelineStore.getState().step(-10)).toBe(false);
    expect(useTimelineStore.getState().blocked).toBe(before + 2);
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
