/**
 * implementation — result store snapshot ring + pin coverage.
 *
 * Covers:
 *   - `captureSuccessfulSnapshot(language)` writes `language` +
 *     `capturedAt`.
 *   - Ring caps at 3 entries; oldest UNPINNED entry is evicted.
 *   - Pinned entries are not evicted; when every slot is pinned,
 *     the fresh capture is refused.
 *   - `clearLastSuccessfulSnapshot()` drops the ring + selector.
 *   - `setCompareTarget` validates against the ring; unknown
 *     capturedAt falls back to `null` (newest).
 *   - `toggleSnapshotPin` flips the flag on the matching entry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useResultStore } from '../../src/renderer/stores/resultStore';

describe('implementation — result store snapshot ring', () => {
  beforeEach(() => {
    useResultStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures the snapshot with language + capturedAt', () => {
    useResultStore.setState({
      lineResults: [{ line: 1, value: '2', type: 'result' }],
      fullOutput: '',
    });
    useResultStore.getState().captureSuccessfulSnapshot('javascript');
    const snapshot = useResultStore.getState().lastSuccessfulSnapshot;
    expect(snapshot?.language).toBe('javascript');
    expect(typeof snapshot?.capturedAt).toBe('number');
    expect(snapshot?.lineResults).toEqual([
      { line: 1, value: '2', type: 'result' },
    ]);
  });

  it('caps the ring at 3 entries by evicting the oldest unpinned', () => {
    for (let index = 0; index < 5; index += 1) {
      useResultStore.setState({
        lineResults: [{ line: 1, value: `${index}`, type: 'result' }],
        fullOutput: '',
      });
      useResultStore.getState().captureSuccessfulSnapshot('javascript');
    }
    const ring = useResultStore.getState().snapshotRing;
    expect(ring.length).toBe(3);
    // The newest three entries' line values should be 2, 3, 4 — older
    // captures were evicted.
    expect(ring.map((entry) => entry.lineResults[0]?.value)).toEqual([
      '2',
      '3',
      '4',
    ]);
  });

  it('assigns monotonic capturedAt ids when captures share a wall-clock millisecond', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));

    for (let index = 0; index < 3; index += 1) {
      useResultStore.setState({
        lineResults: [{ line: 1, value: `${index}`, type: 'result' }],
        fullOutput: '',
      });
      useResultStore.getState().captureSuccessfulSnapshot('javascript');
    }

    const captured = useResultStore
      .getState()
      .snapshotRing.map((entry) => entry.capturedAt);
    expect(captured).toEqual([
      Date.parse('2026-05-14T12:00:00.000Z'),
      Date.parse('2026-05-14T12:00:00.000Z') + 1,
      Date.parse('2026-05-14T12:00:00.000Z') + 2,
    ]);
  });

  it('keeps a pinned entry across multiple subsequent captures', () => {
    useResultStore.setState({
      lineResults: [{ line: 1, value: 'first', type: 'result' }],
      fullOutput: '',
    });
    useResultStore.getState().captureSuccessfulSnapshot('javascript');
    const firstCapturedAt =
      useResultStore.getState().lastSuccessfulSnapshot!.capturedAt;
    useResultStore.getState().toggleSnapshotPin(firstCapturedAt);

    for (let index = 0; index < 5; index += 1) {
      useResultStore.setState({
        lineResults: [{ line: 1, value: `${index}`, type: 'result' }],
        fullOutput: '',
      });
      useResultStore.getState().captureSuccessfulSnapshot('javascript');
    }
    const ring = useResultStore.getState().snapshotRing;
    const pinnedSurvives = ring.find(
      (entry) => entry.capturedAt === firstCapturedAt
    );
    expect(pinnedSurvives?.pinned).toBe(true);
    expect(pinnedSurvives?.lineResults[0]?.value).toBe('first');
  });

  it('clearLastSuccessfulSnapshot drops the ring and the selector', () => {
    useResultStore.setState({
      lineResults: [{ line: 1, value: '2', type: 'result' }],
      fullOutput: '',
    });
    useResultStore.getState().captureSuccessfulSnapshot('javascript');
    useResultStore.getState().setCompareTarget(
      useResultStore.getState().snapshotRing[0]!.capturedAt
    );
    useResultStore.getState().clearLastSuccessfulSnapshot();
    expect(useResultStore.getState().lastSuccessfulSnapshot).toBeNull();
    expect(useResultStore.getState().snapshotRing).toEqual([]);
    expect(
      useResultStore.getState().selectedCompareTargetCapturedAt
    ).toBeNull();
  });

  it('clearVisibleResults preserves the snapshot ring between run attempts', () => {
    useResultStore.setState({
      lineResults: [{ line: 1, value: '2', type: 'result' }],
      fullOutput: '',
    });
    useResultStore.getState().captureSuccessfulSnapshot('javascript');

    useResultStore.getState().clearVisibleResults();

    expect(useResultStore.getState().lineResults).toEqual([]);
    expect(useResultStore.getState().lastSuccessfulSnapshot).not.toBeNull();
    expect(useResultStore.getState().snapshotRing).toHaveLength(1);
  });

  it('setCompareTarget rejects unknown capturedAt values', () => {
    useResultStore.setState({
      lineResults: [{ line: 1, value: '2', type: 'result' }],
      fullOutput: '',
    });
    useResultStore.getState().captureSuccessfulSnapshot('javascript');
    useResultStore.getState().setCompareTarget(99_999);
    expect(
      useResultStore.getState().selectedCompareTargetCapturedAt
    ).toBeNull();
  });

  it('toggleSnapshotPin flips the matching entry', () => {
    useResultStore.setState({
      lineResults: [{ line: 1, value: '2', type: 'result' }],
      fullOutput: '',
    });
    useResultStore.getState().captureSuccessfulSnapshot('javascript');
    const capturedAt =
      useResultStore.getState().lastSuccessfulSnapshot!.capturedAt;
    expect(useResultStore.getState().snapshotRing[0]?.pinned).toBeUndefined();
    useResultStore.getState().toggleSnapshotPin(capturedAt);
    expect(useResultStore.getState().snapshotRing[0]?.pinned).toBe(true);
    useResultStore.getState().toggleSnapshotPin(capturedAt);
    expect(useResultStore.getState().snapshotRing[0]?.pinned).toBe(false);
  });
});
