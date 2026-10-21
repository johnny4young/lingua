import { afterEach, describe, expect, it } from 'vitest';
import { budgetedTabCount } from '../../src/renderer/stores/editorTabUtils';
import {
  registerSqlQueryTabCounter,
  sqlQueryTabCount,
} from '../../src/renderer/stores/sqlQueryTabCount';
import type { FileTab } from '../../src/renderer/types/editor';

const tab = (kind: FileTab['kind']) => ({ kind }) as FileTab;

afterEach(() => {
  registerSqlQueryTabCounter(null);
  localStorage.clear();
});

describe('sqlQueryTabCount', () => {
  it('reads the persisted tabs before the SQL store loads', () => {
    localStorage.setItem(
      'lingua-workspace-sql-state',
      JSON.stringify({ state: { openQueryIds: ['a', 'b'] }, version: 1 })
    );
    expect(sqlQueryTabCount()).toBe(2);
  });

  it('counts the active query of a store from before query tabs', () => {
    localStorage.setItem('lingua-workspace-sql-state', JSON.stringify({ state: { activeQueryId: 'a' } }));
    expect(sqlQueryTabCount()).toBe(1);
  });

  it('survives a missing or broken store', () => {
    expect(sqlQueryTabCount()).toBe(0);
    localStorage.setItem('lingua-workspace-sql-state', '{not json');
    expect(sqlQueryTabCount()).toBe(0);
  });

  it('prefers the live store once registered', () => {
    registerSqlQueryTabCounter(() => 3);
    expect(sqlQueryTabCount()).toBe(3);
  });
});

describe('budgetedTabCount with SQL query tabs', () => {
  it('counts query tabs only while the SQL tab is open', () => {
    registerSqlQueryTabCounter(() => 2);
    expect(budgetedTabCount([tab(undefined), tab('http')])).toBe(1);
    expect(budgetedTabCount([tab(undefined), tab('sql')])).toBe(3);
  });
});
