import type { RichOutputPayload } from '../../../shared/richOutput';
import type { ScopeValue } from '../../../shared/scopeSnapshot';
import { measurableMax } from '../../utils/lastAnswer';
import { truncateText } from '../../../shared/truncateText';
import { formatRelativeTime } from '../../utils/timeLabels';
import { detectColour, detectGauge, detectIsoDate } from './answerDetectors';
import { readLiteral, type Literal } from './answerLiteral';

/** Value colours by type; only `error` means something went wrong. */
type AnswerTone = 'number' | 'string' | 'boolean' | 'date' | 'none' | 'error' | 'plain' | 'pulse';

/** What kind of line produced the answer. */
/** `text` is a reading hint: the value is shown as is, never parsed (a utility's text output). */
export type AnswerRole = 'value' | 'stdout' | 'stderr' | 'error' | 'text';

export interface AnswerInput {
  /** The printed value, always present; a payload refines it. */
  readonly text: string;
  readonly payload?: RichOutputPayload;
  readonly role?: AnswerRole;
  /** Python answers use Python's type names. */
  readonly language?: string;
  /** The statement's source line, read for a threshold to gauge a number against. */
  readonly source?: string;
  /** Full length of a value whose `text` is only its head. */
  readonly length?: number;
}

export interface AnswerContext {
  readonly now: number;
  readonly locale: string;
}

interface ChipCell {
  readonly text: string;
  readonly tone: AnswerTone;
  /** 0–100 of the column's largest value, for a measurable numeric column. */
  readonly bar?: number;
}

export type AnswerPicture =
  /** Up to 24 numbers: one bar each, heights 0–100 across the series' own range. */
  | { readonly kind: 'bars'; readonly heights: readonly number[]; readonly low: string; readonly high: string }
  /** Longer series: one line, points 0–1, and the mean. */
  | { readonly kind: 'spark'; readonly points: readonly number[]; readonly mean: string }
  /** A dict of numbers: bars on one shared scale. */
  | {
      readonly kind: 'scale';
      readonly entries: ReadonlyArray<{ readonly label: string; readonly value: string; readonly width: number }>;
      readonly more: number;
    }
  /** A dict whose values share a type: its keys, and what each one holds. */
  | { readonly kind: 'keys'; readonly keys: readonly string[]; readonly each: string | null; readonly more: number }
  | {
      readonly kind: 'table';
      readonly columns: readonly string[];
      readonly rows: ReadonlyArray<ReadonlyArray<ChipCell>>;
      readonly more: number;
    }
  | {
      readonly kind: 'colours';
      readonly chips: ReadonlyArray<{ readonly label?: string; readonly text: string; readonly css: string }>;
      readonly more: number;
    }
  /** A number against a threshold: fill and mark are 0–100 of the track. */
  | {
      readonly kind: 'gauge';
      readonly fill: number;
      readonly mark: number;
      readonly over: boolean;
      readonly threshold: string;
    }
  | { readonly kind: 'relative'; readonly text: string }
  | { readonly kind: 'progress'; readonly fill: number };

export interface AnswerModel {
  /** Type label, e.g. `list·7`; drawn in small caps. Empty when the answer has no type. */
  readonly tag: string;
  /** Stable type name for styling and tests (`number`, `array`, `error`, …). */
  readonly kind: string;
  readonly tone: AnswerTone;
  /** The value as shown; empty when the picture carries it. */
  readonly value: string;
  /** A scalar sits in a tinted pill; text beside a picture does not. */
  readonly pill: boolean;
  /** Lines folded away after the first. */
  readonly fold: number;
  readonly picture?: AnswerPicture;
  /** The value as one line of text, without the tag: tooltips, compact rows, screen readers. */
  readonly summary: string;
}

const MAX_BARS = 24;
const MAX_ENTRIES = 6;
const MAX_TABLE_COLUMNS = 5;
const MAX_TABLE_ROWS = 6;
const SPARK_POINTS = 48;

interface Vocabulary {
  list: string;
  tuple: string;
  set: string;
  dict: string;
  str: string;
  int: string;
  float: string;
  bool: string;
  date: string;
}

const PYTHON: Vocabulary = {
  list: 'list',
  tuple: 'tuple',
  set: 'set',
  dict: 'dict',
  str: 'str',
  int: 'int',
  float: 'float',
  bool: 'bool',
  date: 'datetime',
};

const SCRIPT: Vocabulary = {
  list: 'array',
  tuple: 'array',
  set: 'set',
  dict: 'object',
  str: 'string',
  int: 'number',
  float: 'number',
  bool: 'boolean',
  date: 'date',
};

interface Reading {
  readonly words: Vocabulary;
  readonly python: boolean;
  readonly source?: string;
  readonly context: AnswerContext;
}

/** Ten significant digits keep a value as written and drop float noise, never integer digits. */
export function formatAnswerNumber(value: number, raw?: string): string {
  if (!Number.isFinite(value)) return raw ?? String(value);
  if (Number.isInteger(value)) {
    if (raw && (!raw.includes('.') || /\.0+$/.test(raw))) return raw;
    if (Math.abs(value) < 1e21) return String(value);
  }
  if (Math.abs(value) >= 1e10) return raw ?? String(value);
  return String(Number(value.toPrecision(10)));
}

type NumLiteral = Extract<Literal, { t: 'num' }>;
type ListLiteral = Extract<Literal, { t: 'list' }>;
type DictLiteral = Extract<Literal, { t: 'dict' }>;
type DictEntry = DictLiteral['entries'][number];

const MAX_SUMMARY = 300;
const TEXT_VALUE_MAX = 600;

function quote(text: string, python: boolean): string {
  const mark = python && !text.includes("'") ? "'" : '"';
  return `${mark}${text}${mark}`;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isFiniteNumber(literal: Literal): literal is NumLiteral {
  return literal.t === 'num' && Number.isFinite(literal.v);
}

function isFilledDict(literal: Literal): literal is DictLiteral {
  return literal.t === 'dict' && literal.entries.length > 0;
}

/** The first line and how many lines follow, without splitting the whole text. */
function firstLine(text: string): { line: string; rest: number } {
  const end = text.indexOf('\n');
  if (end < 0) return { line: text, rest: 0 };
  let rest = 1;
  for (let at = text.indexOf('\n', end + 1); at >= 0; at = text.indexOf('\n', at + 1)) rest += 1;
  return { line: text.slice(0, end), rest };
}

/** Text that shows its first line and folds the rest behind a count. */
function foldedAnswer(tag: string, kind: string, tone: AnswerTone, text: string, pill: boolean, quoted?: boolean): AnswerModel {
  const { line, rest } = firstLine(text);
  return { tag, kind, tone, value: quoted === undefined ? line : quote(line, quoted), pill, fold: rest, summary: truncateText(text, MAX_SUMMARY) };
}

function typeWord(literal: ListLiteral | DictLiteral, reading: Reading): string {
  return literal.t === 'dict' ? reading.words.dict : reading.words[literal.shape];
}

function sizeOf(literal: ListLiteral | DictLiteral): number {
  return literal.t === 'dict' ? literal.entries.length : literal.items.length;
}

function shortRepr(literal: Literal, reading: Reading): string {
  switch (literal.t) {
    case 'num':
      return formatAnswerNumber(literal.v, literal.raw);
    case 'str':
      return quote(truncateText(literal.v, 24), reading.python);
    case 'bool':
      return reading.python ? (literal.v ? 'True' : 'False') : String(literal.v);
    case 'none':
      return literal.raw;
    case 'list':
      return literal.shape === 'tuple' ? `(…${literal.items.length})` : `[…${literal.items.length}]`;
    case 'dict':
      return `{…${literal.entries.length}}`;
  }
}

/** The colour chips for a set of strings, or null when any one is not a colour. */
function colourChips(
  pairs: ReadonlyArray<{ readonly label?: string; readonly literal: Literal }>
): Array<{ label?: string; text: string; css: string }> | null {
  const chips: Array<{ label?: string; text: string; css: string }> = [];
  for (const { label, literal } of pairs) {
    const css = literal.t === 'str' ? detectColour(literal.v) : null;
    if (!css) return null;
    chips.push(label === undefined ? { text: css, css } : { label, text: css, css });
  }
  return chips;
}

function seriesPicture(numbers: readonly number[]): AnswerPicture {
  let min = Infinity;
  let max = -Infinity;
  for (const value of numbers) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const span = max - min;
  if (numbers.length <= MAX_BARS) {
    // Across the series' own range: 130–171 would read flat from zero.
    const heights = numbers.map(value => (span === 0 ? 50 : 20 + (80 * (value - min)) / span));
    return { kind: 'bars', heights, low: formatAnswerNumber(min), high: formatAnswerNumber(max) };
  }
  const step = numbers.length / SPARK_POINTS;
  const points: number[] = [];
  for (let index = 0; index < SPARK_POINTS && Math.floor(index * step) < numbers.length; index += 1) {
    const value = numbers[Math.floor(index * step)]!;
    points.push(span === 0 ? 0.5 : (value - min) / span);
  }
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  return { kind: 'spark', points, mean: formatAnswerNumber(Number(mean.toPrecision(3))) };
}

const CELL_TONE: Record<Literal['t'], AnswerTone> = {
  num: 'number',
  str: 'string',
  bool: 'boolean',
  none: 'none',
  list: 'plain',
  dict: 'plain',
};

function cellOf(literal: Literal | undefined, reading: Reading): ChipCell {
  if (!literal) return { text: '', tone: 'none' };
  return { text: literal.t === 'str' ? quote(literal.v, reading.python) : shortRepr(literal, reading), tone: CELL_TONE[literal.t] };
}

/** Rows already cut to the table's size; `total` counts every row the value had. */
function tablePicture(columns: readonly string[], rows: ReadonlyArray<ReadonlyArray<Literal | undefined>>, total: number, reading: Reading): AnswerPicture {
  const cells = rows.map(row => columns.map((_, index) => cellOf(row[index], reading)));
  // Every measurable numeric column gets bars on its own scale; keys and negatives do not measure.
  columns.forEach((column, index) => {
    const numbers = rows.map(row => {
      const value = row[index];
      return value?.t === 'num' ? value.v : undefined;
    });
    const max = measurableMax(column, numbers);
    if (max === undefined) return;
    cells.forEach((row, rowIndex) => {
      row[index] = { ...row[index]!, bar: (numbers[rowIndex]! / max) * 100 };
    });
  });
  return { kind: 'table', columns, rows: cells, more: Math.max(0, total - rows.length) };
}

function listAnswer(literal: ListLiteral, size: number, reading: Reading): AnswerModel {
  const tag = `${typeWord(literal, reading)}·${size}`;
  const kind = literal.shape === 'set' ? 'set' : 'array';
  const items = literal.items;
  const base = { tag, kind, pill: false, fold: 0 } as const;
  if (items.length >= 2 && items.every(isFiniteNumber)) {
    const picture = seriesPicture(items.map(item => item.v));
    const value = picture.kind === 'bars' ? `${picture.low} – ${picture.high}` : picture.kind === 'spark' ? `μ ${picture.mean}` : '';
    return { ...base, tone: 'number', value, picture, summary: value };
  }
  const chips = items.length > 0 ? colourChips(items.map(literal => ({ literal }))) : null;
  if (chips) {
    const shown = chips.slice(0, MAX_ENTRIES);
    const summary = truncateText(chips.map(chip => chip.text).join(', '), MAX_SUMMARY);
    return { ...base, tone: 'string', value: '', picture: { kind: 'colours', chips: shown, more: size - shown.length }, summary };
  }
  if (items.length > 0 && items.every(isFilledDict)) {
    const columnSet = new Set<string>();
    for (const item of items) for (const entry of item.entries) columnSet.add(entry.key);
    const columns = [...columnSet].slice(0, MAX_TABLE_COLUMNS);
    const rows = items.slice(0, MAX_TABLE_ROWS).map(item => {
      const byKey = new Map(item.entries.map(entry => [entry.key, entry.value]));
      return columns.map(column => byKey.get(column));
    });
    return { ...base, tone: 'plain', value: '', picture: tablePicture(columns, rows, size, reading), summary: [...columnSet].join(', ') };
  }
  const shown = items.slice(0, 4).map(item => shortRepr(item, reading));
  const [open, close] = literal.shape === 'tuple' ? ['(', ')'] : literal.shape === 'set' ? ['{', '}'] : ['[', ']'];
  const value = `${open}${shown.join(', ')}${size > shown.length ? ', …' : ''}${close}`;
  return { ...base, tone: 'plain', value, summary: value };
}

function dictAnswer(literal: DictLiteral, size: number, reading: Reading): AnswerModel {
  const tag = `${reading.words.dict}·${size}`;
  const entries = literal.entries;
  const base = { tag, kind: 'object', pill: false, fold: 0 } as const;
  const values = entries.map(entry => entry.value);
  if (entries.length > 0 && values.every(isFiniteNumber)) {
    const largest = Math.max(...values.map(value => Math.abs(value.v)));
    const shown = entries.slice(0, MAX_ENTRIES).map((entry, index) => ({
      label: entry.key,
      value: formatAnswerNumber(values[index]!.v, values[index]!.raw),
      width: largest === 0 ? 0 : (Math.abs(values[index]!.v) / largest) * 100,
    }));
    const summary = shown.map(entry => `${entry.label} ${entry.value}`).join(', ');
    return { ...base, tone: 'number', value: '', picture: { kind: 'scale', entries: shown, more: size - shown.length }, summary };
  }
  const chips = entries.length > 0 ? colourChips(entries.map(entry => ({ label: entry.key, literal: entry.value }))) : null;
  if (chips) {
    const shown = chips.slice(0, MAX_ENTRIES);
    const summary = truncateText(chips.map(chip => `${chip.label} ${chip.text}`).join(', '), MAX_SUMMARY);
    return { ...base, tone: 'string', value: '', picture: { kind: 'colours', chips: shown, more: size - shown.length }, summary };
  }
  const nested = values.filter((value): value is ListLiteral | DictLiteral => value.t === 'list' || value.t === 'dict');
  if (entries.length >= 2 && nested.length === entries.length) {
    const word = typeWord(nested[0]!, reading);
    if (nested.every(value => typeWord(value, reading) === word)) {
      const sizes = new Set(nested.map(sizeOf));
      const each = sizes.size === 1 ? `${word}·${sizeOf(nested[0]!)}` : word;
      const keys = entries.slice(0, 4).map(entry => entry.key);
      return { ...base, tone: 'string', value: '', picture: { kind: 'keys', keys, each, more: size - keys.length }, summary: `${keys.join(', ')} → ${each}` };
    }
  }
  const shown = entries.slice(0, 3).map(entry => `${entry.key}: ${shortRepr(entry.value, reading)}`);
  const value = `{${shown.join(', ')}${size > shown.length ? ', …' : ''}}`;
  return { ...base, tone: 'plain', value, summary: value };
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** A date as answers show it: weekday, day and time, and how long ago. */
export function answerDateText(time: number, { locale, now }: AnswerContext): { value: string; relative: string } {
  let format = dateFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    dateFormats.set(locale, format);
  }
  return { value: format.format(new Date(time)), relative: formatRelativeTime(time, now, locale) };
}

function dateAnswer(time: number, reading: Reading): AnswerModel {
  const { value, relative } = answerDateText(time, reading.context);
  return { tag: reading.words.date, kind: 'date', tone: 'date', value, pill: true, fold: 0, picture: { kind: 'relative', text: relative }, summary: `${value} · ${relative}` };
}

function stringAnswer(text: string, reading: Reading): AnswerModel {
  const tag = reading.words.str;
  const colour = detectColour(text);
  if (colour) {
    return { tag, kind: 'string', tone: 'string', value: '', pill: false, fold: 0, picture: { kind: 'colours', chips: [{ text: colour, css: colour }], more: 0 }, summary: colour };
  }
  const time = detectIsoDate(text);
  if (time !== null) return dateAnswer(time, reading);
  return foldedAnswer(tag, 'string', 'string', text, true, reading.python);
}

function numberAnswer(literal: NumLiteral, reading: Reading): AnswerModel {
  const { v: value, raw } = literal;
  const shown = formatAnswerNumber(value, raw);
  const tag = Number.isInteger(value) && !raw.includes('.') ? reading.words.int : reading.words.float;
  const gauge = reading.source ? detectGauge(reading.source, value) : null;
  let picture: AnswerPicture | undefined;
  if (gauge) {
    const top = Math.max(gauge.threshold, gauge.measured) * 1.15;
    picture = {
      kind: 'gauge',
      fill: Math.max(0, Math.min(100, (gauge.measured / top) * 100)),
      mark: (gauge.threshold / top) * 100,
      over: gauge.over,
      threshold: formatAnswerNumber(gauge.threshold),
    };
  }
  return { tag, kind: 'number', tone: 'number', value: shown, pill: true, fold: 0, picture, summary: shown };
}

function answerFromLiteral(literal: Literal, reading: Reading): AnswerModel {
  switch (literal.t) {
    case 'num':
      return numberAnswer(literal, reading);
    case 'str':
      return stringAnswer(literal.v, reading);
    case 'bool': {
      const value = shortRepr(literal, reading);
      return { tag: reading.words.bool, kind: 'boolean', tone: 'boolean', value, pill: true, fold: 0, summary: value };
    }
    case 'none':
      return { tag: literal.raw === 'None' ? 'none' : literal.raw, kind: 'null', tone: 'none', value: literal.raw, pill: true, fold: 0, summary: literal.raw };
    case 'list':
      return listAnswer(literal, literal.items.length, reading);
    case 'dict':
      return dictAnswer(literal, literal.entries.length, reading);
  }
}

/** A ScopeValue as a literal, so payloads and printed text share one reading. */
function literalOfScope(value: ScopeValue): Literal | undefined {
  switch (value.kind) {
    case 'primitive':
      if (value.type === 'number') return readLiteral(value.repr) ?? { t: 'num', v: Number(value.repr), raw: value.repr };
      if (value.type === 'boolean') return { t: 'bool', v: value.repr === 'true' || value.repr === 'True' };
      if (value.type === 'null' || value.type === 'undefined') return { t: 'none', raw: value.repr };
      if (value.type === 'string') {
        const read = readLiteral(value.repr);
        // A clamped repr loses its closing quote.
        return read?.t === 'str' ? read : { t: 'str', v: value.repr.replace(/^"/, '') };
      }
      return undefined;
    case 'array': {
      const items = value.entries.map(entry => literalOfScope(entry.value));
      return items.every(isDefined) ? { t: 'list', items, shape: 'list' } : undefined;
    }
    case 'object': {
      const entries = dictEntries(value.entries.map(entry => ({ key: entry.key, value: literalOfScope(entry.value) })));
      return entries ? { t: 'dict', entries } : undefined;
    }
    default:
      return undefined;
  }
}

/** A cell no literal reads (function, bigint, symbol, error) keeps its text instead of going blank. */
function opaqueCell(value: ScopeValue): Literal {
  switch (value.kind) {
    case 'primitive':
      return { t: 'none', raw: value.repr };
    case 'function':
      return { t: 'none', raw: `[Function: ${value.name}]` };
    case 'error':
      return { t: 'none', raw: value.message };
    default:
      return { t: 'none', raw: '…' };
  }
}

function dictEntries(entries: ReadonlyArray<{ key: string; value: Literal | undefined }>): DictEntry[] | null {
  const out: DictEntry[] = [];
  for (const { key, value } of entries) {
    if (!value) return null;
    out.push({ key, value });
  }
  return out;
}

function plainAnswer(tag: string, kind: string, value: string): AnswerModel {
  return { tag, kind, tone: 'plain', value, pill: false, fold: 0, summary: truncateText(value, MAX_SUMMARY) };
}

function payloadAnswer(payload: RichOutputPayload, text: string, reading: Reading): AnswerModel | null {
  switch (payload.kind) {
    case 'table': {
      const total = payload.rows.length + (payload.truncatedRowCount ?? 0);
      const columns = payload.columns.slice(0, MAX_TABLE_COLUMNS);
      const rows = payload.rows.slice(0, MAX_TABLE_ROWS).map(row => row.slice(0, MAX_TABLE_COLUMNS).map(cell => literalOfScope(cell) ?? opaqueCell(cell)));
      const tag = `table·${total}`;
      return { tag, kind: 'table', tone: 'plain', value: '', pill: false, fold: 0, picture: tablePicture(columns, rows, total, reading), summary: payload.columns.join(', ') };
    }
    case 'map': {
      const entries = dictEntries(
        payload.entries.map(entry => {
          const key = literalOfScope(entry.key);
          return { key: key?.t === 'str' ? key.v : key ? shortRepr(key, reading) : '?', value: literalOfScope(entry.value) };
        })
      );
      if (!entries) return null;
      return { ...dictAnswer({ t: 'dict', entries }, payload.size, reading), tag: `map·${payload.size}`, kind: 'map' };
    }
    case 'set': {
      const items = payload.entries.map(literalOfScope);
      return items.every(isDefined) ? listAnswer({ t: 'list', items, shape: 'set' }, payload.size, reading) : null;
    }
    case 'date': {
      const time = Date.parse(payload.iso);
      return Number.isNaN(time) ? plainAnswer(reading.words.date, 'date', payload.iso) : dateAnswer(time, reading);
    }
    case 'array': {
      const literal = literalOfScope(payload);
      return literal?.t === 'list' ? listAnswer(literal, payload.length, reading) : null;
    }
    case 'object': {
      const literal = literalOfScope(payload);
      if (literal?.t !== 'dict') return null;
      const model = dictAnswer(literal, literal.entries.length + (payload.truncatedCount ?? 0), reading);
      const type = payload.previewType;
      return type && type !== 'Object' && type !== 'dict' ? { ...model, tag: `${type.toLowerCase()}·${literal.entries.length}` } : model;
    }
    case 'primitive': {
      const literal = literalOfScope(payload);
      return literal ? answerFromLiteral(literal, reading) : plainAnswer(payload.type, payload.type, payload.repr);
    }
    case 'function':
      return plainAnswer('function', 'function', payload.name || text);
    case 'promise':
      return plainAnswer('promise', 'promise', payload.state);
    case 'progress':
      return {
        tag: 'progress',
        kind: 'progress',
        tone: 'plain',
        value: payload.text ?? `${Math.round(payload.value * 100)}%`,
        pill: false,
        fold: 0,
        picture: { kind: 'progress', fill: Math.max(0, Math.min(100, payload.value * 100)) },
        summary: payload.label,
      };
    case 'image':
    case 'html':
    case 'chart':
      return plainAnswer(payload.kind, payload.kind, text);
    case 'rawText':
    case 'error':
      return null;
  }
}

const STRUCTURED_KINDS = new Set<RichOutputPayload['kind']>(['table', 'map', 'set', 'array', 'object', 'date']);

const PY_DATETIME = /^datetime\.(?:datetime|date)\((\d{4}), (\d{1,2}), (\d{1,2})(?:, (\d{1,2}), (\d{1,2})(?:, (\d{1,2}))?)?/;

/** Reads a run's answer for a line into the shape every answer surface draws. */
export function readAnswer(input: AnswerInput, context: AnswerContext): AnswerModel {
  const python = input.language === 'python';
  const reading: Reading = { words: python ? PYTHON : SCRIPT, python, source: input.source, context };
  const text = input.text;
  if (input.role === 'error' || input.payload?.kind === 'error') {
    return foldedAnswer('error', 'error', 'error', input.payload?.kind === 'error' ? input.payload.message : text, true);
  }
  // Console output keeps a structured payload (console.table, a Map) and otherwise prints as text.
  const printed = input.role === 'stdout' || input.role === 'stderr';
  if (input.payload && (!printed || STRUCTURED_KINDS.has(input.payload.kind))) {
    const model = payloadAnswer(input.payload, text, reading);
    if (model) return model;
  }
  if (input.role === 'stdout' || input.role === 'stderr') return foldedAnswer(input.role, input.role, 'plain', text, false);
  if (input.role === 'text') {
    const model = foldedAnswer(`text·${input.length ?? text.length}`, 'text', 'string', text, false);
    // Three wrapped lines show at most a few hundred characters; the rest would only be laid out.
    return { ...model, value: truncateText(model.value, TEXT_VALUE_MAX) };
  }
  const literal = readLiteral(text);
  if (literal) return answerFromLiteral(literal, reading);
  const trimmed = text.length > 256 ? '' : text.trim();
  const datetime = python ? PY_DATETIME.exec(trimmed) : null;
  if (datetime) {
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = datetime;
    return dateAnswer(new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime(), reading);
  }
  const fn = /^\[Function: (.+)\]$/.exec(trimmed);
  if (fn) return plainAnswer('function', 'function', fn[1]!);
  // A Python value that is not a literal is an object repr; a script string arrives without quotes.
  if (python) return plainAnswer('object', 'object', firstLine(text).line);
  // JSON too large to read, pretty-printed or cut to its head, is still an array or object, not a string.
  const head = firstLine(text);
  const cut = (input.length ?? 0) > text.length;
  const opener = cut ? text.trimStart().charAt(0) : head.line.trim();
  if ((head.rest > 0 || cut) && (opener === '[' || opener === '{')) {
    const preview = truncateText(text.slice(0, 400).replace(/\s+/g, ' ').trim(), 120);
    return plainAnswer(opener === '[' ? reading.words.list : reading.words.dict, opener === '[' ? 'array' : 'object', preview);
  }
  return stringAnswer(text, reading);
}

export interface RunningAnswer {
  readonly elapsedMs?: number;
}

export interface LoopAnswer {
  readonly iteration: number;
  readonly total: number;
  /** The loop variable on this pass, already read as an answer. */
  readonly binding?: { readonly name: string; readonly value: AnswerModel };
}
