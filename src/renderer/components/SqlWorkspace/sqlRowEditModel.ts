/**
 * The grid's staged edits on one table: what is changed, deleted or new, how
 * the rows look with those changes on top, and the change set they become.
 */

import { keyColumns, type RowEditChanges, type RowEditTable, type RowEditValue } from '../../../shared/sqlRowEdits';

type Values = Record<string, RowEditValue>;

export interface StagedEdits {
  /** By row id: the key that finds the row and its changed values. */
  updates: Record<string, { key: Values; values: Values }>;
  deletes: Record<string, { key: Values }>;
  /** New rows, in the order they were added. */
  inserts: Array<{ id: number; values: Values }>;
  nextInsert: number;
}

export const NO_EDITS: StagedEdits = { updates: {}, deletes: {}, inserts: [], nextInsert: 1 };

/** Marks on a row the grid shows: the columns changed, a staged delete, or a new row's id. */
const EDITED = Symbol('edited');
export const DELETED = Symbol('deleted');
const INSERTED = Symbol('inserted');
/** The row as read, so a changed row is still found by its original key. */
const ORIGINAL = Symbol('original');

export type ShownRow = Record<string, unknown> & {
  [EDITED]?: ReadonlySet<string>;
  [DELETED]?: boolean;
  [INSERTED]?: number;
  [ORIGINAL]?: Record<string, unknown>;
};

export type CellTone = 'edited' | 'deleted' | 'inserted';

export function cellTone(row: Record<string, unknown>, column: string): CellTone | undefined {
  const shown = row as ShownRow;
  if (shown[DELETED]) return 'deleted';
  if (shown[INSERTED] !== undefined) return 'inserted';
  return shown[EDITED]?.has(column) ? 'edited' : undefined;
}

/** A cell as the text an edit starts from and the change set carries; null stays SQL NULL. */
export function cellText(value: unknown): RowEditValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** The id and key of a row read from the table, or null when part of its key is missing or NULL. */
function rowIdentity(table: RowEditTable, row: Record<string, unknown>): { id: string; key: Values } | null {
  const source = (row as ShownRow)[ORIGINAL] ?? row;
  const key: Values = {};
  for (const column of keyColumns(table)) {
    const value = cellText(source[column]);
    if (value === null) return null;
    key[column] = value;
  }
  return { id: JSON.stringify(keyColumns(table).map((column) => key[column])), key };
}

export const stagedCount = (edits: StagedEdits) => Object.keys(edits.updates).length + Object.keys(edits.deletes).length + edits.inserts.length;

/** The rows read with the staged changes on top, then the new rows. */
export function overlayRows(rows: ReadonlyArray<Record<string, unknown>>, table: RowEditTable, edits: StagedEdits): Record<string, unknown>[] {
  if (stagedCount(edits) === 0) return rows as Record<string, unknown>[];
  const shown = rows.map((row) => {
    const identity = rowIdentity(table, row);
    const update = identity ? edits.updates[identity.id] : undefined;
    const deleted = identity ? identity.id in edits.deletes : false;
    if (!update && !deleted) return row;
    return { ...row, ...update?.values, [ORIGINAL]: row, [EDITED]: new Set(Object.keys(update?.values ?? {})), ...(deleted ? { [DELETED]: true } : {}) } as ShownRow;
  });
  return [...shown, ...edits.inserts.map(({ id, values }) => ({ ...values, [INSERTED]: id }) as ShownRow)];
}

/** Whether a column of this row can be edited: a table column, not rowid, and not on a row staged for delete. */
export function canEditCell(table: RowEditTable, row: Record<string, unknown>, column: string): boolean {
  const shown = row as ShownRow;
  return !shown[DELETED] && table.columns.includes(column) && (shown[INSERTED] !== undefined || rowIdentity(table, row) !== null);
}

/** Stages one cell; setting it back to what was read drops the change. */
export function stageCell(edits: StagedEdits, table: RowEditTable, row: Record<string, unknown>, column: string, value: RowEditValue): StagedEdits {
  const shown = row as ShownRow;
  if (shown[INSERTED] !== undefined) {
    return { ...edits, inserts: edits.inserts.map((insert) => (insert.id === shown[INSERTED] ? { ...insert, values: { ...insert.values, [column]: value } } : insert)) };
  }
  const identity = rowIdentity(table, row);
  if (!identity) return edits;
  const original = cellText((shown[ORIGINAL] ?? row)[column]);
  const values = { ...edits.updates[identity.id]?.values };
  if (value === original) delete values[column];
  else values[column] = value;
  const updates = { ...edits.updates };
  if (Object.keys(values).length === 0) delete updates[identity.id];
  else updates[identity.id] = { key: identity.key, values };
  return { ...edits, updates };
}

/** Stages a delete, or takes it back; a new row is simply dropped. */
export function toggleDelete(edits: StagedEdits, table: RowEditTable, row: Record<string, unknown>): StagedEdits {
  const shown = row as ShownRow;
  if (shown[INSERTED] !== undefined) return { ...edits, inserts: edits.inserts.filter((insert) => insert.id !== shown[INSERTED]) };
  const identity = rowIdentity(table, row);
  if (!identity) return edits;
  const deletes = { ...edits.deletes };
  const updates = { ...edits.updates };
  if (identity.id in deletes) delete deletes[identity.id];
  else {
    deletes[identity.id] = { key: identity.key };
    // A deleted row's pending changes would never run.
    delete updates[identity.id];
  }
  return { ...edits, deletes, updates };
}

/** A new row; a duplicate copies every table column but the key, which the table fills or the user types. */
export function addRow(edits: StagedEdits, table: RowEditTable, from?: Record<string, unknown>): StagedEdits {
  const keys = new Set(keyColumns(table));
  const values: Values = {};
  if (from) for (const column of table.columns) if (!keys.has(column)) values[column] = cellText(from[column]);
  return { ...edits, inserts: [...edits.inserts, { id: edits.nextInsert, values }], nextInsert: edits.nextInsert + 1 };
}

export function changeSet(edits: StagedEdits): RowEditChanges {
  return {
    updates: Object.values(edits.updates),
    deletes: Object.values(edits.deletes),
    inserts: edits.inserts.map(({ values }) => ({ values })),
  };
}
