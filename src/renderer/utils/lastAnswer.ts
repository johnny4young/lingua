/**
 * A run's answer reduced to what Start and the palette draw: a numeral, its
 * unit, a small picture and a timing. It never holds full output, and the
 * picture keeps only a shape (bar heights 0–100), not the values behind it.
 */

import type { LineResult } from '../stores/resultStore';
import type { ExecutionResult } from '../types/execution';
import { describeError } from './describeError';
import { executionKind } from './executionOutcome';
import { truncateText } from './truncateText';
import type { HttpResponseV1 } from '../../shared/httpWorkspaceSchema';
import type { ProjectTestRunResult } from '../../shared/projectTests';
import type { SqlResponseV1 } from '../../shared/sqlWorkspace';

const KINDS = ['code', 'sql', 'http', 'tests'] as const;
const STATUSES = ['ok', 'error', 'timeout', 'stopped'] as const;
/** `items`: numeral is a min–max range over `total` values. `failed` / `passed`: numeral of `total` tests. */
const UNITS = ['rows', 'status', 'items', 'failed', 'passed'] as const;
/** `bars`: heights 0–100. `phases`: HTTP dns, connect, tls, waiting, download in ms. `cells`: 0 passed, 1 failed, 2 skipped. */
const PICTURES = ['bars', 'phases', 'cells'] as const;

type LastAnswerKind = (typeof KINDS)[number];
type LastAnswerStatus = (typeof STATUSES)[number];
type LastAnswerUnit = (typeof UNITS)[number];

interface LastAnswerPicture {
  kind: (typeof PICTURES)[number];
  values: number[];
}

export interface LastAnswer {
  kind: LastAnswerKind;
  status: LastAnswerStatus;
  /** Empty when the run produced no value to show. */
  numeral: string;
  unit?: LastAnswerUnit;
  total?: number;
  /** Text that follows the numeral as printed (`s` in `1.24 s`), an HTTP status text, or an error name. */
  label?: string;
  /** What answered when it is not the tab itself: a query name, `GET /path`, the first failing test file. */
  subject?: string;
  picture?: LastAnswerPicture;
  durationMs?: number;
  /** Change against the previous answer's duration. */
  deltaMs?: number;
  ranAt: number;
}

export const LAST_ANSWER_NUMERAL_MAX = 24;
const LAST_ANSWER_LABEL_MAX = 24;
export const LAST_ANSWER_SUBJECT_MAX = 80;
export const LAST_ANSWER_PICTURE_MAX = 24;

// Longest printed value read as a series; longer text stays a clipped string.
const SERIES_TEXT_MAX = 16_384;

function clip(text: string, max: number): string {
  return truncateText(text.replace(/\s+/g, ' ').trim(), max);
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return (values as readonly unknown[]).includes(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedMs(value: unknown): number | undefined {
  return finiteNumber(value) ? Math.round(value) : undefined;
}

function durationField(ms: unknown): Pick<LastAnswer, 'durationMs'> {
  const durationMs = boundedMs(ms);
  return durationMs === undefined ? {} : { durationMs };
}

/** Evenly spaced samples so a long series keeps its shape. */
function sample<T>(values: readonly T[]): T[] {
  if (values.length <= LAST_ANSWER_PICTURE_MAX) return [...values];
  const last = values.length - 1;
  return Array.from(
    { length: LAST_ANSWER_PICTURE_MAX },
    (_, index) => values[Math.round((index * last) / (LAST_ANSWER_PICTURE_MAX - 1))]!
  );
}

/** Bar heights 0–100; a series with negatives is scaled from its minimum. */
export function barHeights(values: readonly number[]): number[] {
  const series = sample(values);
  const min = Math.min(...series);
  const max = Math.max(...series);
  const floor = min < 0 ? min : 0;
  const span = max - floor;
  return series.map(value => (span === 0 ? 0 : Math.round(((value - floor) / span) * 100)));
}

/** Locale-free on purpose: the string is stored and read back in any locale. */
function formatSeriesNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(3)));
}

const NUMBER_WITH_UNIT = /^(-?\d[\d_,]*(?:\.\d+)?(?:e[+-]?\d+)?)\s*([a-zA-Zµ%]{1,4})?$/;

function parseNumericArray(text: string): number[] | null {
  if (text.length > SERIES_TEXT_MAX || !text.startsWith('[') || !text.endsWith(']')) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(finiteNumber)) return null;
    return parsed;
  } catch {
    return null;
  }
}

type AnswerFields = Pick<LastAnswer, 'numeral' | 'unit' | 'total' | 'label' | 'picture'>;

/** Reads a printed value: a number with an optional unit, a numeric array, or plain text. */
export function answerFromValue(value: string): AnswerFields {
  const text = value.trim();
  const numeric = NUMBER_WITH_UNIT.exec(text);
  if (numeric) {
    return {
      numeral: clip(numeric[1]!, LAST_ANSWER_NUMERAL_MAX),
      ...(numeric[2] ? { label: numeric[2] } : {}),
    };
  }
  const series = parseNumericArray(text);
  if (series) {
    let min = series[0]!;
    let max = min;
    for (const value of series) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return {
      numeral: clip(
        min === max ? formatSeriesNumber(min) : `${formatSeriesNumber(min)} – ${formatSeriesNumber(max)}`,
        LAST_ANSWER_NUMERAL_MAX
      ),
      unit: 'items',
      total: series.length,
      picture: { kind: 'bars', values: barHeights(series) },
    };
  }
  return { numeral: clip(text, LAST_ANSWER_NUMERAL_MAX) };
}

const VALUE_TYPES = new Set<LineResult['type']>(['result', 'magic', 'watch', 'autoLog']);
const PRINT_TYPES = new Set<LineResult['type']>(['log', 'info']);

/** The row furthest down the file wins; output order breaks ties. */
function lastOnPage(lineResults: readonly LineResult[], types: ReadonlySet<LineResult['type']>): LineResult | undefined {
  let found: LineResult | undefined;
  for (const entry of lineResults) {
    if (types.has(entry.type) && (!found || entry.line >= found.line)) found = entry;
  }
  return found;
}

function lastOutputLine(text: string): string | undefined {
  let end = text.length;
  while (end > 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1;
    const line = text.slice(start, end);
    if (line.trim()) return line;
    end = start - 1;
  }
  return undefined;
}

function codeStatus(result: ExecutionResult): LastAnswerStatus {
  const kind = executionKind(result);
  return kind === 'success' ? 'ok' : kind;
}

/** A code run's answer: its last value, else its last printed line, else the error name. */
export function codeLastAnswer(input: {
  result: ExecutionResult;
  lineResults: readonly LineResult[];
  fullOutput: string;
  ranAt: number;
}): LastAnswer {
  const { result, lineResults, fullOutput, ranAt } = input;
  const status = codeStatus(result);
  const shown =
    lastOnPage(lineResults, VALUE_TYPES)?.value ??
    lastOnPage(lineResults, PRINT_TYPES)?.value ??
    lastOutputLine(fullOutput);
  const errorName = result.error ? (describeError(result.error).name ?? 'Error') : undefined;
  const fields: AnswerFields =
    status === 'error' && errorName
      ? { numeral: '', label: clip(errorName, LAST_ANSWER_LABEL_MAX) }
      : shown !== undefined
        ? answerFromValue(shown)
        : { numeral: '' };
  return {
    kind: 'code',
    status,
    ...fields,
    ...durationField(result.executionTime),
    ranAt,
  };
}

const KEY_COLUMN = /^id$|_id$|Id$/;

/** The first column of non-negative numbers that is not a key, as bar heights. */
function sqlPicture(response: SqlResponseV1): LastAnswerPicture | undefined {
  const rows = response.rows;
  if (rows.length < 2) return undefined;
  for (const column of response.columns) {
    if (KEY_COLUMN.test(column.name)) continue;
    const values = rows.map(row => row[column.name]);
    if (values.every(value => finiteNumber(value) && value >= 0)) return { kind: 'bars', values: barHeights(values as number[]) };
  }
  return undefined;
}

function sqlStatus(status: SqlResponseV1['status']): LastAnswerStatus {
  if (status === 'success' || status === 'too-large') return 'ok';
  if (status === 'timeout') return 'timeout';
  return status === 'cancelled' ? 'stopped' : 'error';
}

export function sqlLastAnswer(response: SqlResponseV1, queryName: string, ranAt: number): LastAnswer {
  const status = sqlStatus(response.status);
  const picture = status === 'ok' ? sqlPicture(response) : undefined;
  return {
    kind: 'sql',
    status,
    numeral: status === 'ok' ? `${response.rowCountIsLowerBound ? '≥' : ''}${response.rowCount}` : '',
    ...(status === 'ok' ? { unit: 'rows' as const } : {}),
    ...(queryName.trim() ? { subject: clip(queryName, LAST_ANSWER_SUBJECT_MAX) } : {}),
    ...(picture ? { picture } : {}),
    ...durationField(response.durationMs),
    ranAt,
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? '';
  }
}

export function httpLastAnswer(response: HttpResponseV1, method: string, ranAt: number): LastAnswer {
  const answered = response.status > 0;
  const timing = response.timing;
  return {
    kind: 'http',
    status: response.kind === 'success' ? 'ok' : response.kind === 'timeout' ? 'timeout' : 'error',
    numeral: answered ? String(response.status) : '',
    ...(answered ? { unit: 'status' as const } : {}),
    ...(response.statusText.trim() ? { label: clip(response.statusText, LAST_ANSWER_LABEL_MAX) } : {}),
    subject: clip(`${method} ${pathOf(response.finalUrl || response.url)}`, LAST_ANSWER_SUBJECT_MAX),
    ...(timing
      ? {
          picture: {
            kind: 'phases' as const,
            values: [timing.dnsMs, timing.connectMs, timing.tlsMs, timing.waitingMs, timing.downloadMs].map(ms =>
              finiteNumber(ms) && ms > 0 ? Math.round(ms) : 0
            ),
          },
        }
      : {}),
    ...durationField(response.durationMs),
    ranAt,
  };
}

export function testsLastAnswer(result: ProjectTestRunResult, ranAt: number): LastAnswer {
  const cases = result.cases ?? [];
  const failed = cases.filter(entry => entry.status === 'failed');
  const passed = cases.filter(entry => entry.status === 'passed').length;
  const status: LastAnswerStatus =
    result.kind === 'timed-out'
      ? 'timeout'
      : result.kind === 'stopped'
        ? 'stopped'
        : result.kind === 'success' && failed.length === 0
          ? 'ok'
          : 'error';
  const timing = { ...durationField(result.executionTime), ranAt };
  if (cases.length === 0) return { kind: 'tests', status, numeral: '', ...timing };
  return {
    kind: 'tests',
    status,
    numeral: String(failed.length > 0 ? failed.length : passed),
    unit: failed.length > 0 ? 'failed' : 'passed',
    total: cases.length,
    ...(failed[0] ? { subject: clip(failed[0].file, LAST_ANSWER_SUBJECT_MAX) } : {}),
    picture: {
      kind: 'cells',
      values: sample(cases.map(entry => (entry.status === 'passed' ? 0 : entry.status === 'failed' ? 1 : 2))),
    },
    ...timing,
  };
}

/** Adds the change against the previous answer's duration. */
export function withDelta(next: LastAnswer, previous: LastAnswer | undefined): LastAnswer {
  if (next.durationMs === undefined || previous?.durationMs === undefined || previous.kind !== next.kind) return next;
  return { ...next, deltaMs: next.durationMs - previous.durationMs };
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? clip(value, max) : undefined;
}


/** Rebuilds a stored answer, dropping anything malformed or over its cap. */
export function sanitizeLastAnswer(value: unknown): LastAnswer | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!includes(KINDS, raw.kind) || !includes(STATUSES, raw.status)) return undefined;
  if (typeof raw.numeral !== 'string' || !finiteNumber(raw.ranAt) || raw.ranAt <= 0) return undefined;
  const unit = includes(UNITS, raw.unit) ? raw.unit : undefined;
  const total = finiteNumber(raw.total) && raw.total >= 0 ? Math.round(raw.total) : undefined;
  const label = boundedString(raw.label, LAST_ANSWER_LABEL_MAX);
  const subject = boundedString(raw.subject, LAST_ANSWER_SUBJECT_MAX);
  const durationMs = boundedMs(raw.durationMs);
  const deltaMs = boundedMs(raw.deltaMs);
  const rawPicture = (raw.picture ?? {}) as Record<string, unknown>;
  const pictureValues = rawPicture.values;
  const picture =
    includes(PICTURES, rawPicture.kind) && Array.isArray(pictureValues) && pictureValues.every(finiteNumber)
      ? { kind: rawPicture.kind, values: pictureValues.slice(0, LAST_ANSWER_PICTURE_MAX).map(Math.round) }
      : undefined;
  return {
    kind: raw.kind as LastAnswerKind,
    status: raw.status as LastAnswerStatus,
    numeral: clip(raw.numeral, LAST_ANSWER_NUMERAL_MAX),
    ...(unit ? { unit } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(label ? { label } : {}),
    ...(subject ? { subject } : {}),
    ...(picture ? { picture } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(deltaMs !== undefined ? { deltaMs } : {}),
    ranAt: raw.ranAt,
  };
}
