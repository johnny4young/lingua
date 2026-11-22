/** Square-root scale, so one slow run does not flatten every other bar to a dot. */
export function latencyShare(durationMs: number, maxMs: number): number {
  if (!(maxMs > 0) || !(durationMs > 0)) return 0;
  return Math.min(1, Math.sqrt(durationMs / maxMs));
}

/** The largest duration in a list, for the bars' shared scale. */
export const maxDuration = (durations: Iterable<number>) => {
  let max = 0;
  for (const duration of durations) if (duration > max) max = duration;
  return max;
};

/** A duration in whole milliseconds, seconds past one: `142 ms`, `2.0 s`. */
export function formatWholeDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
