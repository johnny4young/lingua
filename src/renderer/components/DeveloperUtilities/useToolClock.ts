import { useState } from 'react';
import { useNow } from '../../hooks/useNow';
import { useUtilityPanelActive } from '../../hooks/utilityPanelActive';

const CLOCK_TICK_MS = 30_000;
const NEAR_TICK_MS = 1_000;
const NEAR_MS = 60_000;

/**
 * The clock a time answer reads against: again when the input changes, and every 30 s while the panel shows one,
 * every second while a target is within a minute, where the answer reads in seconds.
 */
export function useToolClock(input: unknown, timed: boolean, targets: readonly (number | null)[] = []): number {
  const [near, setNear] = useState(false);
  const now = useNow(useUtilityPanelActive() && timed, Date.now, near ? NEAR_TICK_MS : CLOCK_TICK_MS, input);
  const nextNear = targets.some(at => at !== null && Math.abs(at - now) < NEAR_MS);
  if (nextNear !== near) setNear(nextNear);
  return now;
}
