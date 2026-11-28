/**
 * One answer per tool: the numeral each Utilities panel heads its result with.
 * Pure readers so tool previews and history rows can share the same reading.
 */
import type { AnswerTone } from '../ui/answer';
import { formatNumber } from '../../i18n/formatNumber';
import { formatRelativeTime } from '../../utils/timeLabels';

export interface ToolAnswer {
  value: string;
  unit?: string;
  lead?: string;
  word?: boolean;
  tone?: AnswerTone;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The largest offset a JavaScript Date can hold. */
const MAX_DATE_MS = 8.64e15;
const TIME_CLAIMS = ['iat', 'nbf', 'exp'] as const;

/** Narrows a tab id to one of a tool's modes. */
export function isOneOf<T extends string>(options: readonly T[], id: string): id is T {
  return (options as readonly string[]).includes(id);
}

/** Code points, without building an array of them. */
export function countChars(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0xdc00 || code > 0xdfff || index === 0 || (text.charCodeAt(index - 1) & 0xfc00) !== 0xd800) count += 1;
  }
  return count;
}

/** A count and its unit, pluralised for the count. */
export function countAnswer(count: number, unitKey: string, t: Translate, locale: string): ToolAnswer {
  return { value: formatNumber(count, locale), unit: t(unitKey, { count }) };
}

/** A seconds claim (iat, nbf, exp) as epoch milliseconds, or null when it is not a usable date. */
export function claimTime(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const at = value * 1000;
  return Math.abs(at) <= MAX_DATE_MS ? at : null;
}

export function hasTimeClaim(payload: Record<string, unknown> | null): boolean {
  return payload !== null && TIME_CLAIMS.some((claim) => claimTime(payload[claim]) !== null);
}

/** Bytes a base64url segment decodes to. */
export function segmentBytes(segment: string): number {
  return Math.floor((segment.replace(/=+$/u, '').length * 3) / 4);
}

const CLAIMS_KEY = 'utilities.answer.jwt.claims';

/**
 * Time left before `exp`, `expired` with how long ago, or the claim count when
 * the token never expires; the meta names the algorithm and, beside a time, the claim count.
 */
export function jwtAnswer(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  now: number,
  t: Translate,
  locale: string
): { answer: ToolAnswer; meta: string } {
  const alg = typeof header.alg === 'string' ? header.alg : null;
  const claims = countAnswer(Object.keys(payload).length, CLAIMS_KEY, t, locale);
  const exp = claimTime(payload.exp);
  const meta = (answer: ToolAnswer, withClaims: boolean) => ({
    answer,
    meta: [alg, withClaims ? `${claims.value} ${claims.unit}` : null].filter(Boolean).join(' · '),
  });
  if (exp === null) return meta(claims, false);
  const left = exp - now;
  if (left <= 0) {
    return meta({ value: t('utilities.answer.jwt.expired'), word: true, unit: formatRelativeTime(exp, now, locale) }, true);
  }
  const [size, key] =
    left < 2 * HOUR
      ? [MINUTE, 'utilities.answer.jwt.minutesLeft']
      : left < 2 * DAY
        ? [HOUR, 'utilities.answer.jwt.hoursLeft']
        : [DAY, 'utilities.answer.jwt.daysLeft'];
  return meta(countAnswer(Math.floor(left / size), key, t, locale), true);
}

export function invalidAnswer(t: Translate): ToolAnswer {
  return { value: t('utilities.answer.invalid'), word: true, tone: 'error' };
}
