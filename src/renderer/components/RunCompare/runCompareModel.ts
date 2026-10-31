import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import { diffLines, DIFF_MAX_INPUT_CHARS } from '../../utils/diff';
import type { RunCompareRecord } from '../../utils/runCompareRecord';
import { languageHasRuntimeModes } from '../../../shared/runtimeModes';
import type { SqlRemoteEngine } from '../../../shared/sqlConnections';
import { ENGINE_LABEL } from '../SqlWorkspace/sqlConnectionStyle';

export const RUN_COMPARE_MAX_DIFF_ROWS = 400;

type RunCompareDayKey = 'today' | 'yesterday' | 'earlier';

export interface RunCompareDayGroup {
  key: RunCompareDayKey;
  /** Local midnight of the day, for the date label of earlier days. */
  day: number;
  entries: ExecutionHistoryEntry[];
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Newest first, one group per local calendar day. */
export function groupRunsByDay(entries: readonly ExecutionHistoryEntry[], now: number): RunCompareDayGroup[] {
  const today = startOfDay(now);
  const yesterday = startOfDay(today - 1);
  const groups: RunCompareDayGroup[] = [];
  for (const entry of [...entries].reverse()) {
    const day = startOfDay(entry.timestamp);
    let group = groups[groups.length - 1];
    if (!group || group.day !== day) {
      group = { key: day === today ? 'today' : day === yesterday ? 'yesterday' : 'earlier', day, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

/** Two picks at most: a third replaces the earlier pick. */
export function toggleRunSelection(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter(value => value !== id);
  return [...selected, id].slice(-2);
}

/** The two newest comparable runs of the active tab, so Compare opens on the last change. */
export function defaultRunSelection(entries: readonly ExecutionHistoryEntry[], tabId: string | null): string[] {
  if (!tabId) return [];
  const picks = entries.filter(entry => entry.tabId === tabId && entry.runCompare).slice(-2);
  return picks.length === 2 ? picks.map(entry => entry.id) : [];
}

type RunCompareDiffRow = { kind: 'add' | 'remove'; text: string } | { kind: 'same'; count: number };

export interface RunCompareSection {
  rows: RunCompareDiffRow[];
  changed: boolean;
  /** Rows past the cap, or input past the diff clamp. */
  cut: boolean;
}

function buildSection(before: string, after: string): RunCompareSection {
  if (before === after) return { rows: [], changed: false, cut: false };
  const rows: RunCompareDiffRow[] = [];
  let changes = 0;
  for (const segment of diffLines(before, after)) {
    if (segment.kind === 'equal') {
      const last = rows[rows.length - 1];
      if (last?.kind === 'same') last.count += 1;
      else rows.push({ kind: 'same', count: 1 });
    } else {
      changes += 1;
      rows.push({ kind: segment.kind, text: segment.text });
    }
  }
  const clamped = before.length > DIFF_MAX_INPUT_CHARS || after.length > DIFF_MAX_INPUT_CHARS;
  return {
    rows: rows.slice(0, RUN_COMPARE_MAX_DIFF_ROWS),
    changed: changes > 0 || clamped,
    cut: clamped || rows.length > RUN_COMPARE_MAX_DIFF_ROWS,
  };
}

interface RunCompareValueChange {
  line: number;
  before?: string;
  after?: string;
}

function lastValueByLine(record: RunCompareRecord): Map<number, string> {
  const map = new Map<number, string>();
  for (const { line, value } of record.values) map.set(line, value);
  return map;
}

function diffValues(older: RunCompareRecord, newer: RunCompareRecord): RunCompareValueChange[] {
  const before = lastValueByLine(older);
  const after = lastValueByLine(newer);
  const lines = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
  return lines
    .filter(line => before.get(line) !== after.get(line))
    .map(line => ({ line, before: before.get(line), after: after.get(line) }));
}

export interface RunComparison {
  code: RunCompareSection;
  stdout: RunCompareSection;
  values: RunCompareValueChange[];
  /** Either side kept no inline values (SQL, HTTP, or none logged). */
  valuesTracked: boolean;
}

export function compareRunRecords(older: RunCompareRecord, newer: RunCompareRecord): RunComparison {
  const output = (record: RunCompareRecord) =>
    record.stderr === '' ? record.stdout : record.stdout === '' ? record.stderr : `${record.stdout}\n${record.stderr}`;
  return {
    code: buildSection(older.code, newer.code),
    stdout: buildSection(output(older), output(newer)),
    values: diffValues(older, newer),
    valuesTracked: older.values.length > 0 || newer.values.length > 0,
  };
}

/** Older first, by time and then by record order. */
export function orderRunPair(
  entries: readonly ExecutionHistoryEntry[],
  ids: readonly string[]
): [ExecutionHistoryEntry, ExecutionHistoryEntry] | null {
  const pair = entries.filter(entry => ids.includes(entry.id) && entry.runCompare);
  return pair.length === 2 ? [pair[0]!, pair[1]!] : null;
}

const RUNTIME_LABELS: Record<string, string> = {
  worker: 'Worker',
  node: 'Node',
  'browser-preview': 'Preview',
  deno: 'Deno',
  bun: 'Bun',
  'duckdb-wasm': 'DuckDB',
};

/** The runtime half of `JS · Worker`; empty when the language has only one. */
export function runRuntimeLabel(record: RunCompareRecord): string {
  if (record.summary?.kind === 'http') return record.summary.method;
  if (record.runtime.startsWith('sql-')) {
    const engine = record.runtime.slice(4);
    return ENGINE_LABEL[engine as SqlRemoteEngine] ?? engine;
  }
  if (record.language === 'sql') return RUNTIME_LABELS[record.runtime] ?? record.runtime;
  return languageHasRuntimeModes(record.language) ? (RUNTIME_LABELS[record.runtime] ?? '') : '';
}

/** The inline value on the lowest line, already one line, else the last stdout line. */
export function runOutputLine(record: RunCompareRecord): string {
  let last: RunCompareRecord['values'][number] | undefined;
  for (const item of record.values) if (!last || item.line >= last.line) last = item;
  if (last?.value) return last.value;
  const lines = record.stdout.split('\n').filter(line => line.trim() !== '');
  return lines[lines.length - 1] ?? '';
}
