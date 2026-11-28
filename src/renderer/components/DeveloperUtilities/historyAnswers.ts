/**
 * One line per Recent runs entry, read once from its stored output: the main
 * value and at most one fact. A time fact keeps its moment, so it reads
 * against the clock on each tick without parsing the output again.
 */
import type { DeveloperUtilityId } from '../../data/developerUtilityCatalog';
import { parseColorToRgb, rgbToHex } from '../../utils/developerUtilityDetection';
import { parseJsonObject } from '../../utils/jwt';
import { formatRelativeTime } from '../../utils/timeLabels';
import { outputHead, shortenMiddle } from './launcherPreviews';
import { CLAIMS_KEY, claimTime, clockText, countAnswer, countChars, dateText, dayText, type Translate } from './toolAnswers';

type HistoryTone = 'string' | 'number' | 'date' | 'none' | 'neutral';

export interface HistoryAnswer {
  value: string;
  tone: HistoryTone;
  swatch?: string;
  fact?: string;
  factTone?: HistoryTone;
  /** A moment the fact reads against now: a JWT's expiry, or a timestamp's distance. */
  timed?: { at: number; kind: 'exp' | 'since' };
}

const VALUE_MAX = 24;
/** Past this an output is no single number or colour; only its head is read. */
const SCALAR_MAX = 64;

/** `eyJhbGci…pR2Ys`: the head and the tail of the input, as the board shortens a token. */
export function shortInput(input: string): string {
  return shortenMiddle(input.replace(/\s+/gu, ' ').trim(), 8, 5);
}

function sizeFact(stored: string, cut: boolean, t: Translate, locale: string): string {
  // A cut output ends in the store's ellipsis, which is not part of it.
  const output = cut && stored.endsWith('…') ? stored.slice(0, -1) : stored;
  let lines = 1;
  for (let at = output.indexOf('\n'); at !== -1; at = output.indexOf('\n', at + 1)) lines += 1;
  const size = lines > 1 ? countAnswer(lines, 'utilities.history.answer.lines', t, locale) : countAnswer(countChars(output), 'utilities.answer.chars', t, locale);
  return `${size.value}${cut ? '+' : ''} ${size.unit}`;
}

/** The answer one stored run gives, read the way its tool reads the output. */
export function readHistoryAnswer(
  utilityId: DeveloperUtilityId,
  output: string,
  outputCut: boolean,
  t: Translate,
  locale: string
): HistoryAnswer {
  if (output.trim().length === 0) return { value: t('utilities.history.answer.noOutput'), tone: 'none' };
  if (utilityId === 'jwt') {
    const payload = parseJsonObject(output);
    if (payload) {
      const count = countAnswer(Object.keys(payload).length, CLAIMS_KEY, t, locale);
      const head: HistoryAnswer =
        typeof payload.sub === 'string'
          ? { value: `"${outputHead(payload.sub, VALUE_MAX)}"`, tone: 'string' }
          : { value: `${count.value} ${count.unit}`, tone: 'neutral' };
      const exp = claimTime(payload.exp);
      return exp === null ? { ...head, fact: t('utilities.history.answer.noExp'), factTone: 'none' } : { ...head, timed: { at: exp, kind: 'exp' } };
    }
  }
  const scalar = output.length <= SCALAR_MAX ? output.trim() : '';
  if (utilityId === 'timestamp') {
    const at = Date.parse(scalar);
    if (!Number.isNaN(at)) return { value: dateText(at, locale), tone: 'date', timed: { at, kind: 'since' } };
  }
  if (utilityId === 'color') {
    const rgb = parseColorToRgb(scalar);
    if (rgb) return { value: scalar, tone: 'neutral', swatch: rgbToHex(rgb) };
  }
  if (/^-?\d+(\.\d+)?$/u.test(scalar)) return { value: outputHead(scalar, VALUE_MAX), tone: 'number' };
  const head = outputHead(output, VALUE_MAX);
  const structured = /^[[{<]/u.test(head);
  return {
    value: structured ? head : `"${head}"`,
    tone: structured ? 'neutral' : 'string',
    fact: sizeFact(output, outputCut, t, locale),
  };
}

/** The fact a timed answer gives at `now`. */
export function timedFact(timed: NonNullable<HistoryAnswer['timed']>, now: number, t: Translate, locale: string): string {
  const when = formatRelativeTime(timed.at, now, locale);
  if (timed.kind === 'since') return when;
  return t(timed.at > now ? 'utilities.history.answer.expIn' : 'utilities.history.answer.expired', { when });
}

/** `12:57` for a run today, `Nov 11` for an older saved one. */
export function runTime(at: number, now: number, locale: string): string {
  if (!Number.isFinite(at)) return '';
  return new Date(now).toDateString() === new Date(at).toDateString() ? clockText(at, locale) : dayText(at, locale);
}
