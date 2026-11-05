import { describe, expect, it } from 'vitest';
import {
  addRow,
  canEditCell,
  canSetCellNull,
  cellTone,
  changeSet,
  NO_EDITS,
  overlayRows,
  stageCell,
  stagedCount,
  toggleDelete,
} from '../../../src/renderer/components/SqlWorkspace/sqlRowEditModel';
import type { RowEditTable } from '../../../src/shared/sqlRowEdits';

const table: RowEditTable = { engine: 'postgres', schema: 'public', name: 'orders', columns: ['id', 'city', 'total'], key: { kind: 'pk', columns: ['id'] } };
const rows = [
  { id: 10401, city: 'Medellin', total: '3410.00' },
  { id: 10402, city: 'Bogota', total: null },
];

describe('staged edits in the grid', () => {
  it('shows a changed cell over the row, finds it by its original key, and drops a change set back to what was read', () => {
    let edits = stageCell(NO_EDITS, table, rows[0]!, 'total', '3450.00');
    const shown = overlayRows(rows, table, edits);
    expect(shown[0]).toMatchObject({ id: 10401, total: '3450.00' });
    expect(cellTone(shown[0]!, 'total')).toBe('edited');
    expect(cellTone(shown[0]!, 'city')).toBeUndefined();
    edits = stageCell(edits, table, shown[0]!, 'id', '1');
    expect(changeSet(edits).updates).toEqual([{ key: { id: '10401' }, values: { total: '3450.00', id: '1' } }]);
    edits = stageCell(edits, table, overlayRows(rows, table, edits)[0]!, 'total', '3410.00');
    edits = stageCell(edits, table, overlayRows(rows, table, edits)[0]!, 'id', '10401');
    expect(stagedCount(edits)).toBe(0);
  });

  it('stages a delete that drops the row changes, and takes it back', () => {
    let edits = stageCell(NO_EDITS, table, rows[1]!, 'city', 'Cali');
    edits = toggleDelete(edits, table, rows[1]!);
    expect(changeSet(edits)).toEqual({ updates: [], deletes: [{ key: { id: '10402' } }], inserts: [] });
    const shown = overlayRows(rows, table, edits);
    expect(cellTone(shown[1]!, 'city')).toBe('deleted');
    expect(canEditCell(table, shown[1]!, 'city')).toBe(false);
    expect(stagedCount(toggleDelete(edits, table, shown[1]!))).toBe(0);
  });

  it('adds empty and duplicated rows without the key, edits them, and drops a new row on delete', () => {
    let edits = addRow(NO_EDITS, table);
    edits = addRow(edits, table, rows[0]);
    const shown = overlayRows(rows, table, edits);
    expect(shown).toHaveLength(4);
    expect(cellTone(shown[3]!, 'city')).toBe('inserted');
    edits = stageCell(edits, table, shown[2]!, 'city', 'Envigado');
    expect(changeSet(edits).inserts).toEqual([{ values: { city: 'Envigado' } }, { values: { city: 'Medellin', total: '3410.00' } }]);
    edits = toggleDelete(edits, table, overlayRows(rows, table, edits)[3]!);
    expect(changeSet(edits).inserts).toEqual([{ values: { city: 'Envigado' } }]);
  });

  it('never edits rowid, a column outside the table, or a row whose key is missing', () => {
    const local: RowEditTable = { engine: 'duckdb', name: 'sales', columns: ['region'], key: { kind: 'rowid' } };
    const row = { rowid: 3, region: 'north' };
    expect(canEditCell(local, row, 'region')).toBe(true);
    expect(canEditCell(local, row, 'rowid')).toBe(false);
    expect(canEditCell(local, { region: 'x' }, 'region')).toBe(false);
    expect(canEditCell(table, rows[0]!, 'computed')).toBe(false);
    expect(changeSet(stageCell(NO_EDITS, local, row, 'region', null))).toEqual({ updates: [{ key: { rowid: '3' }, values: { region: null } }], deletes: [], inserts: [] });
  });
});

describe('staged edits with column types', () => {
  const typed: RowEditTable = {
    engine: 'postgres',
    name: 'files',
    columns: ['id', 'city', 'n', 'body', 'at'],
    types: { id: 'integer', city: 'varchar(40)', n: 'bigint', body: 'bytea', at: 'timestamp' },
    key: { kind: 'pk', columns: ['id'] },
  };
  const row = { id: 1, city: 'Cali', n: '9007199254740993', body: 'AP8Q', at: '2026-01-01T00:00:00.000Z' };

  it('checks the columns an update changes, and every comparable column on a delete', () => {
    const edited = stageCell(NO_EDITS, typed, row, 'city', 'Bogota');
    expect(changeSet(edited).updates).toEqual([{ key: { id: '1' }, values: { city: 'Bogota' }, original: { city: 'Cali' } }]);
    const shown = overlayRows([row], typed, edited)[0]!;
    expect(changeSet(stageCell(edited, typed, shown, 'n', '7')).updates[0]?.original).toEqual({ city: 'Cali', n: '9007199254740993' });
    expect(changeSet(toggleDelete(NO_EDITS, typed, row)).deletes).toEqual([{ key: { id: '1' }, original: { id: '1', city: 'Cali', n: '9007199254740993' } }]);
  });

  it('checks every comparable column when only rowid finds the row', () => {
    const local: RowEditTable = { engine: 'duckdb', name: 't', columns: ['a', 'b'], types: { a: 'VARCHAR', b: 'INTEGER' }, key: { kind: 'rowid' } };
    expect(changeSet(stageCell(NO_EDITS, local, { rowid: 3, a: 'x', b: 1 }, 'a', 'y')).updates[0]?.original).toEqual({ a: 'x', b: '1' });
  });

  it('does not compare a value too long to carry', () => {
    const long = 'x'.repeat(5000);
    expect(changeSet(toggleDelete(NO_EDITS, typed, { ...row, city: long })).deletes[0]?.original).not.toHaveProperty('city');
  });

  it('never types into a binary cell, but lets it become NULL', () => {
    expect(canEditCell(typed, row, 'body')).toBe(false);
    expect(canSetCellNull(typed, row, 'body')).toBe(true);
    expect(canEditCell(typed, row, 'city')).toBe(true);
    expect(changeSet(stageCell(NO_EDITS, typed, row, 'body', null)).updates[0]?.values).toEqual({ body: null });
  });

  it('leaves binaries and values the grid cannot read exactly out of a duplicate', () => {
    expect(changeSet(addRow(NO_EDITS, typed, row)).inserts).toEqual([{ values: { city: 'Cali', n: '9007199254740993' } }]);
  });

  it('turns a cleared number or date into NULL, and keeps an empty text', () => {
    expect(changeSet(stageCell(NO_EDITS, typed, row, 'n', '')).updates[0]?.values).toEqual({ n: null });
    expect(changeSet(stageCell(NO_EDITS, typed, row, 'city', '')).updates[0]?.values).toEqual({ city: '' });
    const added = addRow(NO_EDITS, typed);
    const shown = overlayRows([], typed, added)[0]!;
    expect(changeSet(stageCell(added, typed, shown, 'at', '')).inserts[0]?.values).toEqual({ at: null });
  });
});
