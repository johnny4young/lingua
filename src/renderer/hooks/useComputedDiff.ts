import { useEffect, useMemo, useState } from 'react';
import { computeDiffOffThread } from '../runtime/utilityComputeClient';
import { computeDiff } from '../utils/diff';
import type { DiffGranularity, DiffSegment } from '../utils/diff';

/** Small diffs are cheaper than worker startup; heavy diffs leave the UI thread. */
export const OFF_THREAD_DIFF_THRESHOLD_CHARS = 4_000;

interface WorkerDiffResult {
  readonly left: string;
  readonly right: string;
  readonly granularity: DiffGranularity;
  readonly segments: DiffSegment[];
}

export function useComputedDiff(
  left: string,
  right: string,
  granularity: DiffGranularity,
  enabled = true
): DiffSegment[] {
  const shouldUseWorker =
    enabled &&
    typeof Worker !== 'undefined' &&
    left.length + right.length >= OFF_THREAD_DIFF_THRESHOLD_CHARS;
  const synchronous = useMemo(
    () => (enabled && !shouldUseWorker ? computeDiff(left, right, granularity) : []),
    [enabled, shouldUseWorker, left, right, granularity]
  );
  const [workerResult, setWorkerResult] = useState<WorkerDiffResult | null>(null);

  useEffect(() => {
    if (!shouldUseWorker) return;
    let active = true;
    void computeDiffOffThread(left, right, granularity).then((segments) => {
      if (active) setWorkerResult({ left, right, granularity, segments });
    });
    return () => {
      active = false;
    };
  }, [shouldUseWorker, left, right, granularity]);

  if (!shouldUseWorker) return synchronous;
  return workerResult?.left === left &&
    workerResult.right === right &&
    workerResult.granularity === granularity
    ? workerResult.segments
    : [];
}
