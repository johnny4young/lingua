/**
 * RL-097 Slice 2 — workspaceSqlStore tests.
 *
 * Mirror coverage of `tests/stores/workspaceToolStore.test.ts` for
 * the SQL workspace persisted store. CRUD + LRU + active-id reset
 * + isExecuting reset on switch.
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
    expect(state.isExecutingActive).toBe(false);
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

  it('deleteQuery shifts the active id when deleting the active', () => {
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'a' }));
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'b' }));
    useWorkspaceSqlStore.getState().deleteQuery('b');
    const state = useWorkspaceSqlStore.getState();
    expect(state.queries.map((q) => q.id)).toEqual(['a']);
    expect(state.activeQueryId).toBe('a');
  });

  it('setActiveQuery resets isExecutingActive on switch', () => {
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'a' }));
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'b' }));
    useWorkspaceSqlStore.getState().setIsExecutingActive(true);
    expect(useWorkspaceSqlStore.getState().isExecutingActive).toBe(true);
    useWorkspaceSqlStore.getState().setActiveQuery('a');
    expect(useWorkspaceSqlStore.getState().isExecutingActive).toBe(false);
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
});
