/**
 * workspaceSqlStore tests.
 *
 * Mirror coverage of `tests/stores/workspaceToolStore.test.ts` for
 * the SQL workspace persisted store. CRUD + LRU + active-id reset.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetWorkspaceSqlStoreForTests,
  useWorkspaceSqlStore,
} from '../../src/renderer/stores/workspaceSqlStore';
import { createBlankSqlQuery, type SqlResponseV1 } from '../../src/shared/sqlWorkspace';

function freshResponse(overrides: Partial<SqlResponseV1> = {}): SqlResponseV1 {
  return {
    version: 1,
    status: 'success',
    rows: [{ a: 1 }],
    columns: [{ name: 'a', type: 'INTEGER' }],
    rowCount: 1,
    durationMs: 10,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  resetWorkspaceSqlStoreForTests();
});

describe('useWorkspaceSqlStore', () => {
  it('starts empty', () => {
    const state = useWorkspaceSqlStore.getState();
    expect(state.queries).toEqual([]);
    expect(state.activeQueryId).toBeNull();
    expect(state.storageMode).toBe('memory');
    expect(state.storageRequestedMode).toBe('memory');
  });

  it('records resolved and requested SQL storage mode separately', () => {
    useWorkspaceSqlStore.getState().setStorageMode('memory', 'opfs');
    const state = useWorkspaceSqlStore.getState();
    expect(state.storageMode).toBe('memory');
    expect(state.storageRequestedMode).toBe('opfs');
  });

  it('createQuery prepends and sets active', () => {
    const q1 = createBlankSqlQuery({ id: 'a', name: 'first' });
    const q2 = createBlankSqlQuery({ id: 'b', name: 'second' });
    useWorkspaceSqlStore.getState().createQuery(q1);
    useWorkspaceSqlStore.getState().createQuery(q2);
    const state = useWorkspaceSqlStore.getState();
    expect(state.queries.map((q) => q.id)).toEqual(['b', 'a']);
    expect(state.activeQueryId).toBe('b');
  });

  it('updateQuery patches and bumps updatedAt', () => {
    const q = createBlankSqlQuery({
      id: 'a',
      name: 'name',
      now: '2026-05-26T00:00:00.000Z',
    });
    useWorkspaceSqlStore.getState().createQuery(q);
    useWorkspaceSqlStore.getState().updateQuery('a', { name: 'renamed' });
    const updated = useWorkspaceSqlStore.getState().getQuery('a');
    expect(updated?.name).toBe('renamed');
    expect(updated?.updatedAt).not.toBe('2026-05-26T00:00:00.000Z');
  });

  it('updateQuery preserves the version + id pin', () => {
    const q = createBlankSqlQuery({ id: 'a' });
    useWorkspaceSqlStore.getState().createQuery(q);
    useWorkspaceSqlStore
      .getState()
      .updateQuery('a', { id: 'malicious', version: 2 as 1 });
    const got = useWorkspaceSqlStore.getState().getQuery('a');
    expect(got?.id).toBe('a');
    expect(got?.version).toBe(1);
  });

  it('duplicateQuery clones the query text + timeout under a fresh id and selects it', () => {
    const source = createBlankSqlQuery({
      id: 'a',
      name: 'src',
      query: 'SELECT 1;',
      now: '2026-05-26T00:00:00.000Z',
    });
    useWorkspaceSqlStore.getState().createQuery(source);
    useWorkspaceSqlStore.getState().updateQuery('a', { timeoutMs: 1234 });

    useWorkspaceSqlStore
      .getState()
      .duplicateQuery('a', { id: 'clone', name: 'src copy' });

    const state = useWorkspaceSqlStore.getState();
    // Clone is prepended + active.
    expect(state.queries.map((q) => q.id)).toEqual(['clone', 'a']);
    expect(state.activeQueryId).toBe('clone');
    const clone = state.getQuery('clone');
    expect(clone?.name).toBe('src copy');
    expect(clone?.query).toBe('SELECT 1;');
    expect(clone?.timeoutMs).toBe(1234);
    // The source is untouched.
    expect(state.getQuery('a')?.name).toBe('src');
  });

  it('duplicateQuery gives the clone no response history', () => {
    useWorkspaceSqlStore
      .getState()
      .createQuery(createBlankSqlQuery({ id: 'a', query: 'SELECT 1;' }));
    useWorkspaceSqlStore.getState().recordResponse('a', freshResponse());

    useWorkspaceSqlStore
      .getState()
      .duplicateQuery('a', { id: 'clone', name: 'copy' });

    expect(
      useWorkspaceSqlStore.getState().getLatestResponse('clone')
    ).toBeUndefined();
    // The source keeps its history.
    expect(
      useWorkspaceSqlStore.getState().getLatestResponse('a')
    ).toBeDefined();
  });

  it('duplicateQuery no-ops on an unknown source id', () => {
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'a' }));
    const before = useWorkspaceSqlStore.getState().queries.length;
    useWorkspaceSqlStore
      .getState()
      .duplicateQuery('missing', { id: 'clone', name: 'copy' });
    expect(useWorkspaceSqlStore.getState().queries.length).toBe(before);
    expect(useWorkspaceSqlStore.getState().getQuery('clone')).toBeUndefined();
  });

  it('deleteQuery shifts the active id when deleting the active', () => {
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'a' }));
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'b' }));
    useWorkspaceSqlStore.getState().deleteQuery('b');
    const state = useWorkspaceSqlStore.getState();
    expect(state.queries.map((q) => q.id)).toEqual(['a']);
    expect(state.activeQueryId).toBe('a');
  });

  it('recordResponse strips rows from previous entries', () => {
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'a' }));
    useWorkspaceSqlStore
      .getState()
      .recordResponse('a', freshResponse({ rows: [{ x: 1 }] }));
    useWorkspaceSqlStore
      .getState()
      .recordResponse('a', freshResponse({ rows: [{ y: 2 }] }));
    const list = useWorkspaceSqlStore.getState().responsesByQueryId['a'];
    expect(list).toBeDefined();
    expect(list?.[0]?.rows).toEqual([{ y: 2 }]); // newest keeps rows
    expect(list?.[1]?.rows).toEqual([]); // older stripped
  });

  it('recordResponse applies LRU cap of 10', () => {
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'a' }));
    for (let i = 0; i < 12; i += 1) {
      useWorkspaceSqlStore.getState().recordResponse('a', freshResponse({ durationMs: i }));
    }
    const list = useWorkspaceSqlStore.getState().responsesByQueryId['a'];
    expect(list?.length).toBe(10);
    expect(list?.[0]?.durationMs).toBe(11); // newest
  });

  it('clearHistory wipes one query', () => {
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'a' }));
    useWorkspaceSqlStore.getState().recordResponse('a', freshResponse());
    useWorkspaceSqlStore.getState().clearHistory('a');
    expect(useWorkspaceSqlStore.getState().responsesByQueryId['a']).toBeUndefined();
  });

  it('getLatestResponse returns the newest response', () => {
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'a' }));
    useWorkspaceSqlStore.getState().recordResponse('a', freshResponse({ durationMs: 1 }));
    useWorkspaceSqlStore.getState().recordResponse('a', freshResponse({ durationMs: 2 }));
    expect(useWorkspaceSqlStore.getState().getLatestResponse('a')?.durationMs).toBe(2);
  });

  it('recordResponse no-ops when the query id is unknown', () => {
    useWorkspaceSqlStore.getState().recordResponse('ghost', freshResponse());
    expect(useWorkspaceSqlStore.getState().responsesByQueryId['ghost']).toBeUndefined();
  });

  it('remembers the folded Explorer and each table source, and prunes dropped tables', () => {
    const store = useWorkspaceSqlStore.getState();
    store.toggleExplorerFolded();
    store.setTableSource('sales', 'csv');
    store.setTableSource('events', 'parquet');
    expect(useWorkspaceSqlStore.getState().explorerFolded).toBe(true);
    useWorkspaceSqlStore.getState().pruneTableSources(['events']);
    expect(useWorkspaceSqlStore.getState().tableSources).toEqual({ events: 'parquet' });
  });

  it('persists the Explorer state and sanitizes it on rehydrate', async () => {
    useWorkspaceSqlStore.getState().toggleExplorerFolded();
    useWorkspaceSqlStore.getState().setTableSource('sales', 'csv');
    const stored = JSON.parse(localStorage.getItem('lingua-workspace-sql-state') ?? '{}');
    expect(stored.state.explorerFolded).toBe(true);
    expect(stored.state.tableSources).toEqual({ sales: 'csv' });

    stored.state.explorerFolded = 'yes';
    stored.state.tableSources = { sales: 'csv', evil: 'exe', list: ['csv'] };
    localStorage.setItem('lingua-workspace-sql-state', JSON.stringify(stored));
    await useWorkspaceSqlStore.persist.rehydrate();
    expect(useWorkspaceSqlStore.getState().explorerFolded).toBe(false);
    expect(useWorkspaceSqlStore.getState().tableSources).toEqual({ sales: 'csv' });
  });

  describe('query tabs, saving and history', () => {
    const q = (id: string, extra: Partial<Parameters<typeof createBlankSqlQuery>[0]> = {}) =>
      createBlankSqlQuery({ id, query: `SELECT '${id}'`, ...extra });

    it('opens created queries as tabs and focuses the neighbour when one closes', () => {
      const store = useWorkspaceSqlStore.getState();
      store.createQuery(q('a'));
      store.createQuery(q('b'));
      store.createQuery(q('c'));
      expect(useWorkspaceSqlStore.getState().openQueryIds).toEqual(['a', 'b', 'c']);
      useWorkspaceSqlStore.getState().setActiveQuery('b');
      useWorkspaceSqlStore.getState().closeQueryTab('b');
      const state = useWorkspaceSqlStore.getState();
      expect(state.openQueryIds).toEqual(['a', 'c']);
      expect(state.activeQueryId).toBe('c');
      // A saved query closes but stays in Saved queries.
      expect(state.queries.map((query) => query.id)).toContain('b');
    });

    it('discards a scratch with its tab, and saving turns it into a filed query', () => {
      const store = useWorkspaceSqlStore.getState();
      store.createQuery(q('s1', { kind: 'scratch' }));
      store.createQuery(q('s2', { kind: 'scratch' }));
      useWorkspaceSqlStore.getState().closeQueryTab('s1');
      expect(useWorkspaceSqlStore.getState().getQuery('s1')).toBeUndefined();
      useWorkspaceSqlStore.getState().saveQuery('s2', { name: ' Orders by city ', folder: ' Reports ' });
      expect(useWorkspaceSqlStore.getState().getQuery('s2')).toMatchObject({
        name: 'Orders by city',
        folder: 'Reports',
      });
      expect(useWorkspaceSqlStore.getState().getQuery('s2')?.kind).toBeUndefined();
    });

    it('reopens a closed saved query as a tab without duplicating it', () => {
      const store = useWorkspaceSqlStore.getState();
      store.createQuery(q('a'));
      useWorkspaceSqlStore.getState().closeQueryTab('a');
      useWorkspaceSqlStore.getState().openQueryTab('a');
      useWorkspaceSqlStore.getState().openQueryTab('a');
      expect(useWorkspaceSqlStore.getState().openQueryIds).toEqual(['a']);
      expect(useWorkspaceSqlStore.getState().activeQueryId).toBe('a');
    });

    it('saves a copy into the source tab with Save as', () => {
      const store = useWorkspaceSqlStore.getState();
      store.createQuery(q('a'));
      store.createQuery(q('b'));
      useWorkspaceSqlStore.getState().saveQueryAs('a', { id: 'a2', name: ' Copy ', folder: 'Reports' });
      const state = useWorkspaceSqlStore.getState();
      expect(state.openQueryIds).toEqual(['a2', 'b']);
      expect(state.activeQueryId).toBe('a2');
      expect(state.getQuery('a2')).toMatchObject({ name: 'Copy', folder: 'Reports', query: "SELECT 'a'" });
      expect(state.getQuery('a')).toBeDefined();
    });

    it('keeps the newest 200 history entries', () => {
      for (let i = 0; i < 205; i += 1) {
        useWorkspaceSqlStore.getState().recordHistory({
          version: 1,
          id: `h${i}`,
          sql: `SELECT ${i}`,
          status: 'success',
          durationMs: 1,
          rowCount: 1,
          recordedAt: '2026-10-20T00:00:00.000Z',
        });
      }
      const { history } = useWorkspaceSqlStore.getState();
      expect(history).toHaveLength(200);
      expect(history[0]?.id).toBe('h204');
      useWorkspaceSqlStore.getState().clearSqlHistory();
      expect(useWorkspaceSqlStore.getState().history).toEqual([]);
    });

    it('clears the history of one connection, or of Local, and keeps the rest', () => {
      const run = (id: string, connectionId?: string) =>
        useWorkspaceSqlStore.getState().recordHistory({
          version: 1,
          id,
          ...(connectionId ? { connectionId } : {}),
          sql: 'SELECT 1',
          status: 'success',
          durationMs: 1,
          rowCount: 1,
          recordedAt: '2026-10-20T00:00:00.000Z',
        });
      run('local');
      run('dev', 'c_dev');
      run('prod', 'c_prod');
      useWorkspaceSqlStore.getState().clearSqlHistory('c_dev');
      expect(useWorkspaceSqlStore.getState().history.map((entry) => entry.id)).toEqual(['prod', 'local']);
      useWorkspaceSqlStore.getState().clearSqlHistory(null);
      expect(useWorkspaceSqlStore.getState().history.map((entry) => entry.id)).toEqual(['prod']);
    });

    it('opens only the active query as a tab when rehydrating a store from before tabs', async () => {
      const legacy = {
        state: {
          queries: [q('old1'), q('old2', { name: 'Named' })],
          responsesByQueryId: {},
          activeQueryId: 'old2',
        },
        version: 1,
      };
      localStorage.setItem('lingua-workspace-sql-state', JSON.stringify(legacy));
      await useWorkspaceSqlStore.persist.rehydrate();
      const state = useWorkspaceSqlStore.getState();
      expect(state.openQueryIds).toEqual(['old2']);
      expect(state.queries.every((query) => query.kind === undefined)).toBe(true);
      expect(state.history).toEqual([]);
    });
  });
});
