import { useNow } from '../../hooks/useNow';
import { useUtilityPanelActive } from '../../hooks/utilityPanelActive';

const CLOCK_TICK_MS = 30_000;

/** The clock a time answer reads against: again when the input changes, and every 30 s while the panel shows one. */
export function useToolClock(input: unknown, timed: boolean): number {
  return useNow(useUtilityPanelActive() && timed, Date.now, CLOCK_TICK_MS, input);
}
