/**
 * Column windowing for wide results: widths worked out from the data, so the
 * grid can mount only the columns on screen and still lay out like auto layout.
 */

import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { groupsDigits, isIdentifierColumn } from './sqlColumnInstruments';
import { BIN_COUNT, isTemporal } from './sqlColumnStats';
import { renderCell } from './sqlResultFormatters';

/** More shown columns than this mounts only those on screen; fewer keeps the table's auto layout. */
export const MAX_AUTO_LAYOUT_COLUMNS = 30;

const SAMPLE_ROWS = 200;
// The grid's mono type: 11 px cells, 9 px type labels with 0.04em tracking.
const CELL_CHAR_PX = 6.6;
const TYPE_CHAR_PX = 5.76;
const CELL_PADDING_PX = 21;
const BAR_PX = 56;
/** A numeric cell's scale bar: its track and the gap after the number. */
export const SCALE_BAR_TRACK_PX = 88;
export const SCALE_BAR_GAP_PX = 10;
/** The header spark: one tick per histogram bin, 1 px apart; the name sits on its own line below. */
export const SPARK_TICK_PX = 3;
export const SPARK_HEIGHT_PX = 9;
const SPARK_WIDTH_PX = BIN_COUNT * (SPARK_TICK_PX + 1);
// The type line's second half, after a 6 px gap: the spark or "· sorted ↑" (localized, with its arrow), and a text column's "· 10,000+ distinct".
const SORTED_META_PX = Math.max(SPARK_WIDTH_PX, 12 * TYPE_CHAR_PX + 14);
const DISTINCT_META_PX = 20 * TYPE_CHAR_PX;
const META_GAP_PX = 6;
const FK_ARROW_CHARS = 2;
const MAX_CELL_PX = 512;
const MIN_NUMERIC_PX = 130;
const MIN_TEXT_PX = 200;
const MAX_CELL_CHARS = Math.ceil((MAX_CELL_PX - CELL_PADDING_PX) / CELL_CHAR_PX);
/** Without a measured viewport (jsdom, first paint) mount a screenful. */
const UNMEASURED_VIEWPORT_PX = 1280;
const WIDE_CHARS = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3ffff}]/gu;

export interface TypedColumn {
  col: SqlColumnMetadata;
  duckType: string;
  numeric: boolean;
  index: number;
}

export interface ColumnPlan {
  widths: ReadonlyArray<number>;
  /** Each column's left edge, then the table's width. */
  offsets: ReadonlyArray<number>;
}

/** Columns skipped in a row, drawn as one empty cell spanning them. */
export interface ColumnGap {
  key: string;
  gap: number;
}

export type ColumnSlot = TypedColumn | ColumnGap;

function cellChars(value: unknown, duckType: string, grouped: boolean): number {
  // BLOBs and image data URLs draw as thumbnails that fit any column; their text is base64 nobody reads across.
  if (duckType === 'BLOB' || (typeof value === 'string' && value.startsWith('data:image/'))) return 0;
  const text = renderCell(value);
  if (text.length >= MAX_CELL_CHARS) return MAX_CELL_CHARS;
  // The grid draws a grouped number with a separator every three integer digits.
  const separators = grouped ? Math.floor(((/^-?(\d+)/.exec(text)?.[1]?.length ?? 1) - 1) / 3) : 0;
  return text.length + separators + (text.match(WIDE_CHARS)?.length ?? 0);
}

/**
 * Widths from evenly spaced rows and the header text, within the limits the
 * table's auto layout reaches. Every column that may draw a scale bar gets its
 * room up front, since the plan holds while Load more changes the scales.
 */
export function planColumns(
  typed: ReadonlyArray<TypedColumn>,
  rows: ReadonlyArray<Record<string, unknown>>,
  fractions: ReadonlySet<string>,
  linkedColumns: ReadonlySet<string> | undefined
): ColumnPlan {
  const longest = typed.map(() => 0);
  const grouped = typed.map(({ col, numeric }) => numeric && linkedColumns?.has(col.name) !== true && groupsDigits(col.name));
  const step = Math.max(1, Math.floor(rows.length / SAMPLE_ROWS));
  // Row by row, and past a column's cap never again: a long JSON value is costly to stringify.
  for (let r = 0; r < rows.length; r += step) {
    const row = rows[r]!;
    for (let c = 0; c < typed.length; c++) {
      if (longest[c]! >= MAX_CELL_CHARS) continue;
      const chars = cellChars(row[typed[c]!.col.name], typed[c]!.duckType, grouped[c]!);
      if (chars > longest[c]!) longest[c] = chars;
    }
  }
  const widths = typed.map(({ col, duckType, numeric }, c) => {
    const linked = linkedColumns?.has(col.name) === true;
    const decoration =
      (linked ? FK_ARROW_CHARS * CELL_CHAR_PX : 0) + (fractions.has(col.name) ? BAR_PX : numeric && !linked && !isIdentifierColumn(col.name) ? SCALE_BAR_TRACK_PX + SCALE_BAR_GAP_PX : 0);
    const cell = Math.min(MAX_CELL_PX, longest[c]! * CELL_CHAR_PX + CELL_PADDING_PX + decoration);
    const typeLabel = linked ? `${duckType} · FK` : duckType;
    const typeLine = typeLabel.length * TYPE_CHAR_PX + META_GAP_PX + (numeric || isTemporal(duckType) ? SORTED_META_PX : DISTINCT_META_PX);
    const header = Math.max(col.name.length * CELL_CHAR_PX, typeLine) + CELL_PADDING_PX;
    return Math.ceil(Math.max(numeric ? MIN_NUMERIC_PX : MIN_TEXT_PX, cell, header));
  });
  const offsets = [0];
  for (const width of widths) offsets.push(offsets[offsets.length - 1]! + width);
  return { widths, offsets };
}

function columnAt(offsets: ReadonlyArray<number>, x: number): number {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle]! <= x) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The inclusive range of columns to mount, the horizontal counterpart of `fixedRowWindow`. */
export function fixedColumnWindow(params: {
  offsets: ReadonlyArray<number>;
  scrollLeft: number;
  viewportWidth: number;
  overscan: number;
}): { start: number; end: number } {
  const { offsets, scrollLeft, viewportWidth, overscan } = params;
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: -1 };
  const left = Math.max(0, scrollLeft);
  const width = viewportWidth > 0 ? viewportWidth : UNMEASURED_VIEWPORT_PX;
  return {
    start: Math.max(0, columnAt(offsets, left) - overscan),
    end: Math.min(count - 1, columnAt(offsets, left + width) + overscan),
  };
}

/** A row's cells: the window, a column kept mounted outside it if any, and gaps for the rest. */
export function columnSlots(typed: ReadonlyArray<TypedColumn>, start: number, end: number, pinned = -1): ReadonlyArray<ColumnSlot> {
  const outside = pinned >= 0 && (pinned < start || pinned > end);
  const ranges = !outside ? [[start, end]] : pinned < start ? [[pinned, pinned], [start, end]] : [[start, end], [pinned, pinned]];
  const slots: ColumnSlot[] = [];
  let next = 0;
  ranges.forEach(([from, to], position) => {
    if (from! > next) slots.push({ key: `gap-${position}`, gap: from! - next });
    for (let c = from!; c <= to!; c++) slots.push(typed[c]!);
    next = to! + 1;
  });
  if (next < typed.length) slots.push({ key: 'gap-end', gap: typed.length - next });
  return slots;
}
