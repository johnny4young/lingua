import { describe, expect, it } from 'vitest';
import {
  addRow,
  canEditCell,
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
