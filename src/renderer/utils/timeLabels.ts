/** `2026-10-17T00:00:00.000Z` → `2026-10-17 00:00:00 UTC`. */
export function utcDateLabel(iso: string): string {
  return iso.replace('T', ' ').replace(/(\.\d+)?Z$/u, ' UTC');
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

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
  let format = relativeFormats.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'short' });
    relativeFormats.set(locale, format);
  }
  return format.format(Math.round(delta / size), unit);
}

/** A duration in whole milliseconds, seconds past one: `142 ms`, `2.0 s`. */
export function formatWholeDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

type Translate = (key: string, values?: Record<string, number>) => string;

/** "1 second ago" … "3 hours ago" for this session's runs; never "0 seconds". */
/** A run's duration: `0.4 ms`, `13 ms`, `18.90 s`; `—` when timing never ran. */
export function formatRunDuration(durationMs: number | null): string {
  const { value, unit } = splitRunDuration(durationMs);
  return unit ? `${value} ${unit}` : value;
}

/** The same duration as a numeral and its unit, for surfaces that set them apart. */
export function splitRunDuration(durationMs: number | null): { value: string; unit: 'ms' | 's' | null } {
  if (durationMs === null || !Number.isFinite(durationMs)) return { value: '—', unit: null };
  const safe = Math.max(0, durationMs);
  if (safe < 10) return { value: safe.toFixed(1), unit: 'ms' };
  if (safe < 1000) return { value: String(Math.round(safe)), unit: 'ms' };
  return { value: (safe / 1000).toFixed(2), unit: 's' };
}

/** Time left before a run's limit, as m:ss. */
export function formatCountdown(remainingMs: number): string {
  const seconds = Math.floor(Math.max(0, remainingMs) / 1000);
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function formatRunAge(timestamp: number, now: number, t: Translate): string {
  const seconds = Math.round(Math.max(0, now - timestamp) / SECOND);
  if (seconds < 60) return t('executionHistory.relative.seconds', { count: Math.max(1, seconds) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('executionHistory.relative.minutes', { count: minutes });
  return t('executionHistory.relative.hours', { count: Math.round(minutes / 60) });
}
