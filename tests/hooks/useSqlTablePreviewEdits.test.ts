import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { executeQuery, loadLocalEditTable } = vi.hoisted(() => ({ executeQuery: vi.fn(), loadLocalEditTable: vi.fn() }));
vi.mock('../../src/renderer/runtime/duckdbClient', () => ({ executeQuery }));
vi.mock('../../src/renderer/runtime/sqlLocalEdits', () => ({ loadLocalEditTable, applyLocalEdits: vi.fn() }));
vi.mock('../../src/renderer/runtime/sqlForeignKeys', () => ({
  loadTableForeignKeys: vi.fn(async () => ({ outgoing: [], incoming: [] })),
  buildLookupSql: vi.fn(),
  countReferences: vi.fn(),
}));

import { useSqlTablePreview } from '../../src/renderer/hooks/useSqlTablePreview';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useSqlConnectionsStore } from '../../src/renderer/stores/sqlConnectionsStore';
import type { SqlDbConnectionView } from '../../src/shared/sqlDb';

const outcome = { status: 'success', columns: [], rows: [], rowCount: 0, durationMs: 1, tooLarge: false, statementCount: 1 };

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue(outcome);
  loadLocalEditTable.mockReset();
  useSettingsStore.setState({ featureFlags: { editRows: true, dbClient: true } });
});
afterEach(() => {
  useSettingsStore.setState({ featureFlags: {} });
  useSqlConnectionsStore.setState({ catalog: null });
  delete (window as { lingua?: unknown }).lingua;
});

describe('opening a table for editing', () => {
  it('reads rowid with a keyless Local table, and nothing extra when the flag is off', async () => {
    loadLocalEditTable.mockResolvedValue({ engine: 'duckdb', name: 'sales', columns: ['region'], key: { kind: 'rowid' } });
    const { result } = renderHook(() => useSqlTablePreview(1000, []));
    await act(() => result.current.open({ name: 'sales' }));
    expect(executeQuery).toHaveBeenLastCalledWith('SELECT rowid, * FROM "sales" LIMIT 100;', { timeoutMs: 1000 });
    expect(result.current.preview?.edit).toEqual({ table: { engine: 'duckdb', name: 'sales', columns: ['region'], key: { kind: 'rowid' } } });
    useSettingsStore.setState({ featureFlags: {} });
    await act(() => result.current.open({ name: 'sales' }));
    expect(executeQuery).toHaveBeenLastCalledWith('SELECT * FROM "sales" LIMIT 100;', { timeoutMs: 1000 });
    expect(result.current.preview?.edit).toBeUndefined();
  });

  it('takes a connection table key from its catalog, and says why read-only, production and views are not edited', async () => {
    const connection = (overrides: Partial<SqlDbConnectionView>) => ({ id: 'c_1', name: 'orders', engine: 'postgres', readOnly: false, ...overrides }) as SqlDbConnectionView;
    const introspect = vi.fn(async () => ({ detail: { columns: [{ name: 'id', type: 'int', nullable: false, primaryKey: true }, { name: 'city', type: 'text', nullable: true }] } }));
    const execute = vi.fn(async () => ({ status: 'success', engine: 'postgres', columns: [], rows: [], rowCount: 0, tooLarge: false, rowCountIsLowerBound: false, hasMore: false, durationMs: 1 }));
    (window as { lingua?: unknown }).lingua = { platform: 'darwin', db: { introspect, execute } };
    const remote = { connectionId: 'c_1', engine: 'postgres' as const };
    const table = { name: 'public.orders', sqlName: 'orders', schemaName: 'public', kind: 'table' as const };
    const { result } = renderHook(() => useSqlTablePreview(1000, []));
    const openWith = async (overrides: Partial<SqlDbConnectionView>, kind: 'table' | 'view' = 'table') => {
      useSqlConnectionsStore.setState({ catalog: { connections: [connection(overrides)], adhoc: [], used: 1, limit: 3, vault: 'encrypted' } });
      await act(() => result.current.open({ ...table, kind }, undefined, undefined, remote));
      return result.current.preview?.edit;
    };
    expect(await openWith({})).toEqual({ table: { engine: 'postgres', schema: 'public', name: 'orders', columns: ['id', 'city'], key: { kind: 'pk', columns: ['id'] } } });
    expect(introspect).toHaveBeenCalledWith('c_1', { level: 'detail', schema: 'public', name: 'orders', kind: 'table' });
    expect(await openWith({ readOnly: true })).toEqual({ reason: 'read-only' });
    expect(await openWith({ env: 'prod' })).toEqual({ reason: 'production' });
    expect(await openWith({}, 'view')).toEqual({ reason: 'view' });
    introspect.mockResolvedValueOnce({ detail: { columns: [{ name: 'city', type: 'text', nullable: true }] } } as never);
    expect(await openWith({})).toEqual({ reason: 'no-key' });
  });
});
