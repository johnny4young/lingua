/** `2026-10-17T00:00:00.000Z` → `2026-10-17 00:00:00 UTC`. */
export function utcDateLabel(iso: string): string {
  return iso.replace('T', ' ').replace(/(\.\d+)?Z$/u, ' UTC');
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "in 23 hr" / "1 hr ago" in the given locale. Hours run up to two days, so a
 * token that expires tomorrow reads in hours rather than "in 1 day".
 */
export function formatRelativeTime(targetMs: number, nowMs: number, locale: string): string {
  const delta = targetMs - nowMs;
  const absolute = Math.abs(delta);
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    absolute >= 2 * DAY
      ? ['day', DAY]
      : absolute >= HOUR
        ? ['hour', HOUR]
        : absolute >= MINUTE
          ? ['minute', MINUTE]
          : ['second', SECOND];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'short' }).format(
    Math.round(delta / size),
    unit
  );
}

type Translate = (key: string, values?: Record<string, number>) => string;

/** "1 second ago" … "3 hours ago" for this session's runs; never "0 seconds". */
/** A run's duration: `0.4 ms`, `13 ms`, `18.90 s`; `—` when timing never ran. */
export function formatRunDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  if (durationMs < 10) return `${durationMs.toFixed(1)} ms`;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

export function formatRunAge(timestamp: number, now: number, t: Translate): string {
  const seconds = Math.round(Math.max(0, now - timestamp) / SECOND);
  if (seconds < 60) return t('executionHistory.relative.seconds', { count: Math.max(1, seconds) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('executionHistory.relative.minutes', { count: minutes });
  return t('executionHistory.relative.hours', { count: Math.round(minutes / 60) });
}
