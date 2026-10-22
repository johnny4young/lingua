import { describe, expect, it, vi } from 'vitest';
import { buildSqlQuickOpenItems, type SqlQuickOpenSources } from '../../../src/renderer/components/SqlWorkspace/sqlQuickOpenScope';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace';

const t = (key: string, options?: Record<string, unknown>) => (options?.folder ? `${key}:${String(options.folder)}` : key);

function sources(overrides: Partial<SqlQuickOpenSources> = {}): SqlQuickOpenSources {
  return {
    t,
    localTables: [
      { name: 'cities', sqlName: 'cities', kind: 'table' },
      { name: 'lingua_ledger.runs', sqlName: 'runs', schemaName: 'lingua_ledger', kind: 'table' },
    ],
    queries: [
      { ...createBlankSqlQuery({ id: 'q1', name: 'Orders by city', query: 'SELECT 1' }), folder: 'Reports' },
      { ...createBlankSqlQuery({ id: 'q2', name: 'Scratch 1', query: '' }), kind: 'scratch' },
    ],
    catalogs: {
      c_dev: {
        generation: 0,
        objects: {
          public: {
            status: 'ready',
            value: [
              { kind: 'table', name: 'order items' },
              { kind: 'function', name: 'order_total', signature: 'bigint' },
              { kind: 'sequence', name: 'orders_id_seq' },
            ],
          },
        },
        columns: {},
        details: {},
      },
      c_gone: { generation: 0, objects: { public: { status: 'ready', value: [{ kind: 'table', name: 'ghost' }] } }, columns: {}, details: {} },
    },
    connection: (id) => (id === 'c_dev' ? { name: 'orders-dev', engine: 'mysql' } : undefined),
    showRemote: vi.fn(),
    openLocal: vi.fn(),
    openQuery: vi.fn(),
    insert: vi.fn(),
    ...overrides,
  };
}

describe('buildSqlQuickOpenItems', () => {
  it('lists remote objects, Local tables and saved queries, leaving out sequences, scratches and the ledger', () => {
    const items = buildSqlQuickOpenItems(sources());
    expect(items.map((item) => [item.badge, item.name, item.detail])).toEqual([
      ['sqlWorkspace.remote.quickOpen.badge.table', 'public.order items', 'orders-dev'],
      ['sqlWorkspace.remote.quickOpen.badge.function', 'public.order_total(bigint)', 'orders-dev'],
      ['sqlWorkspace.remote.quickOpen.badge.table', 'cities', 'sqlWorkspace.connection.localName'],
      ['sqlWorkspace.remote.quickOpen.badge.query', 'Orders by city', 'sqlWorkspace.remote.quickOpen.savedIn:Reports'],
    ]);
  });

  it('opens data, shows structure and inserts the name quoted for the engine', () => {
    const source = sources();
    const [table, fn] = buildSqlQuickOpenItems(source);
    table!.open();
    table!.structure!();
    table!.insert!();
    fn!.open();
    fn!.insert!();
    const ref = { schema: 'public', name: 'order items', kind: 'table' };
    expect(source.showRemote).toHaveBeenNthCalledWith(1, 'c_dev', ref, 'data');
    expect(source.showRemote).toHaveBeenNthCalledWith(2, 'c_dev', ref, 'columns');
    expect(source.showRemote).toHaveBeenNthCalledWith(3, 'c_dev', { schema: 'public', name: 'order_total', kind: 'function', signature: 'bigint' }, 'ddl');
    expect(source.insert).toHaveBeenNthCalledWith(1, '`public`.`order items`');
    expect(source.insert).toHaveBeenNthCalledWith(2, 'order_total');
  });
});
