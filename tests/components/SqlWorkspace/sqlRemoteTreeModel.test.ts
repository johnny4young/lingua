import { describe, expect, it } from 'vitest';
import { groupRemoteObjects } from '../../../src/renderer/components/SqlWorkspace/sqlRemoteTreeModel';
import type { SqlDbObjectInfo } from '../../../src/shared/sqlDb';

const objects: SqlDbObjectInfo[] = [
  { kind: 'table', name: 'orders' },
  { kind: 'view', name: 'orders_by_day' },
  { kind: 'function', name: 'order_total', signature: 'bigint' },
  { kind: 'procedure', name: 'archive' },
  { kind: 'extension', name: 'pgcrypto' },
];

const ids = (groups: ReturnType<typeof groupRemoteObjects>) => groups.map((group) => [group.id, group.objects.map((object) => object.name)]);

describe('groupRemoteObjects', () => {
  it('groups by the engine, keeping Tables when it is empty', () => {
    expect(ids(groupRemoteObjects('postgres', objects, ''))).toEqual([
      ['tables', ['orders']],
      ['views', ['orders_by_day']],
      ['functions', ['order_total', 'archive']],
      ['extensions', ['pgcrypto']],
    ]);
    expect(ids(groupRemoteObjects('mysql', objects, ''))).toEqual([
      ['tables', ['orders']],
      ['views', ['orders_by_day']],
      ['routines', ['order_total', 'archive']],
    ]);
    expect(ids(groupRemoteObjects('sqlite', [], ''))).toEqual([['tables', []]]);
  });

  it('keeps only groups with a match while filtering', () => {
    expect(ids(groupRemoteObjects('postgres', objects, ' ORD'))).toEqual([
      ['tables', ['orders']],
      ['views', ['orders_by_day']],
      ['functions', ['order_total']],
    ]);
  });
});
