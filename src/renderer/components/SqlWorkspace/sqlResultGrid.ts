/**
 * SQL workspace USABILITY upgrade — pure helpers for the result grid.
 *
 * In-memory client-side sort + filter over the preview rows. Kept
 * side-effect free so the grid interactions (sort toggle, filter box)
 * have focused unit coverage without React. The DuckDB result is the
 * source of truth; these only reorder / hide the already-fetched
 * preview rows — they never re-run a query.
 */

export type SqlSortDirection = 'asc' | 'desc';

export interface SqlSortState {
  /** Column name being sorted; `null` means original (insertion) order. */
  column: string | null;
  direction: SqlSortDirection;
}

/**
 * Toggle the sort state for a header click. First click on a column →
 * ascending; second click on the same column → descending; third click
 * → back to unsorted (original order). Clicking a different column
 * resets to ascending on the new column.
 */
export function nextSortState(
  current: SqlSortState,
  column: string
): SqlSortState {
  if (current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return { column: null, direction: 'asc' };
}

/**
 * Compare two cell values with type-aware ordering:
 *   - null / undefined sort last (in ascending order).
 *   - numbers + bigints compare numerically.
 *   - booleans compare false < true.
 *   - everything else compares as a locale-aware string.
 * Returns the ascending comparison; the caller flips for descending.
 */
function compareCells(a: unknown, b: unknown): number {
  const aNil = a === null || a === undefined;
  const bNil = b === null || b === undefined;
  if (aNil && bNil) return 0;
  if (aNil) return 1; // nulls last
  if (bNil) return -1;

  const aNum = toComparableNumber(a);
  const bNum = toComparableNumber(b);
  if (aNum !== null && bNum !== null) {
    if (aNum < bNum) return -1;
    if (aNum > bNum) return 1;
    return 0;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }

  return stringifyForCompare(a).localeCompare(stringifyForCompare(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function toComparableNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

function stringifyForCompare(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

/**
 * Sort rows by the given column. Stable: equal cells keep their
 * original relative order. Returns a new array; the input is not
 * mutated. A `null` column returns the rows unchanged (original order).
 */
export function sortRows<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  sort: SqlSortState
): T[] {
  if (sort.column === null) return [...rows];
  const column = sort.column;
  const factor = sort.direction === 'asc' ? 1 : -1;
  // Stable sort via index decoration — Array.prototype.sort is stable
  // in modern engines, but the index tiebreaker keeps it explicit.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const cmp = compareCells(left.row[column], right.row[column]);
      if (cmp !== 0) return cmp * factor;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

/**
 * Filter rows to those where ANY cell value contains the (lowercased)
 * needle as a substring. An empty / whitespace needle returns the rows
 * unchanged. Cell values are stringified close to how the grid renders
 * them (strings as-is, numbers/booleans/bigints via `String`, objects
 * via `JSON.stringify`). Note: null / undefined stringify to the JSON
 * token `null` here, whereas the grid paints them as an em dash — so
 * typing `null` matches empty cells the user sees as `—`.
 */
export function filterRows<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  needle: string
): T[] {
  const trimmed = needle.trim().toLowerCase();
  if (trimmed.length === 0) return [...rows];
  return rows.filter((row) =>
    Object.values(row).some((value) =>
      stringifyForCompare(value).toLowerCase().includes(trimmed)
    )
  );
}
