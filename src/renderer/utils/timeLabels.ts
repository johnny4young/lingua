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
export function relativeTimeLabel(targetMs: number, nowMs: number, locale: string): string {
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
