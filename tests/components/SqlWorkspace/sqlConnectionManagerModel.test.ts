import { describe, expect, it } from 'vitest';
import { connectionWhere, duplicateDraft, groupConnections, importDraft, isAlreadySaved } from '../../../src/renderer/components/SqlWorkspace/sqlConnectionManagerModel';
import type { SqlDbConnectionView } from '../../../src/shared/sqlDb';

const view = (overrides: Partial<SqlDbConnectionView>): SqlDbConnectionView => ({
  version: 1,
  id: 'c_1',
  name: 'orders-dev',
  engine: 'postgres',
  host: 'db.internal',
  port: 5432,
  database: 'orders',
  user: 'app',
  readOnly: false,
  passwordMode: 'keychain',
  createdAt: '',
  updatedAt: '',
  hasPassword: true,
  ...overrides,
});

describe('connection manager model', () => {
  const list = [
    view({ id: 'a', name: 'orders-prod', group: 'Ratfel', env: 'prod' }),
    view({ id: 'b', name: 'billing', engine: 'mysql', host: 'billing.internal', group: 'Ratfel' }),
    view({ id: 'c', name: 'app.db', engine: 'sqlite', host: undefined, port: undefined, path: '/data/app.db' }),
    view({ id: 'd', name: 'legacy', group: 'Clients' }),
  ];

  it('groups by name with ungrouped last, and searches name, host, group, environment and engine', () => {
    expect(groupConnections(list, '').map((group) => [group.name, group.connections.map((entry) => entry.id)])).toEqual([
      ['Clients', ['d']],
      ['Ratfel', ['b', 'a']],
      [undefined, ['c']],
    ]);
    expect(groupConnections(list, 'billing.internal').flatMap((group) => group.connections.map((entry) => entry.id))).toEqual(['b']);
    expect(groupConnections(list, 'ratfel prod').flatMap((group) => group.connections.map((entry) => entry.id))).toEqual(['a']);
    expect(groupConnections(list, 'sqlite').flatMap((group) => group.connections.map((entry) => entry.id))).toEqual(['c']);
    expect(groupConnections(list, 'nothing')).toEqual([]);
  });

  it('shows host, port and database, or the file name', () => {
    expect(connectionWhere(list[0]!)).toBe('db.internal:5432/orders');
    expect(connectionWhere(list[2]!)).toBe('app.db');
  });

  it('flags an import that points at a saved database the same way', () => {
    expect(isAlreadySaved({ draft: { ...list[0]!, name: 'other', host: 'DB.internal' } }, list)).toBe(true);
    expect(isAlreadySaved({ draft: { ...list[0]!, user: 'admin' } }, list)).toBe(false);
    expect(isAlreadySaved({ draft: { name: 'x', engine: 'sqlite', path: '/data/app.db', readOnly: false, passwordMode: 'none' } }, list)).toBe(true);
  });

  it('applies the chosen password mode, keeps none, and asks each session without a keychain', () => {
    const candidate = { draft: { ...list[0]!, ssh: { host: 'bastion', port: 22, user: 'u', auth: 'password' as const, secretMode: 'keychain' as const } } };
    expect(importDraft(candidate, 'session', false)).toMatchObject({ passwordMode: 'session', ssh: { secretMode: 'session' } });
    expect(importDraft(candidate, 'keychain', true)).toMatchObject({ passwordMode: 'session', ssh: { secretMode: 'session' } });
    expect(importDraft({ draft: { ...list[0]!, passwordMode: 'none' } }, 'keychain', false).passwordMode).toBe('none');
  });

  it('duplicates without the id, the timestamps or the secret flags', () => {
    const copy = duplicateDraft(list[0]!, 'copy');
    expect(copy).toMatchObject({ name: 'orders-prod copy', group: 'Ratfel', host: 'db.internal' });
    expect(copy).not.toHaveProperty('id');
    expect(copy).not.toHaveProperty('hasPassword');
  });
});
