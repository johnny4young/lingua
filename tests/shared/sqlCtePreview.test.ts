import { describe, expect, it } from 'vitest';
import { cteDependents, INSTANT_SAMPLE_ROWS, instantAstBlockReason, parseCteChain, planInstantPreview } from '../../src/shared/sqlCtePreview';

const SALES = `WITH cities AS (
  SELECT * FROM read_csv('sales.csv')
),
totals AS (
  SELECT city, sum(orders) AS orders,
         sum(revenue) AS revenue
  FROM cities GROUP BY city
)
SELECT *, revenue / orders AS ticket
FROM totals ORDER BY revenue DESC;`;

describe('parseCteChain', () => {
  it('finds each CTE, its range and what it reads', () => {
    const chain = parseCteChain(SALES.replace(/;$/, ''))!;
    expect(chain.ctes.map((cte) => [cte.key, cte.dependsOn])).toEqual([
      ['cities', []],
      ['totals', ['cities']],
    ]);
    const totals = chain.ctes[1]!;
    expect(SALES.slice(totals.start, totals.end)).toMatch(/^totals AS \([\s\S]*GROUP BY city\n\)$/);
    expect(SALES.slice(chain.mainStart)).toMatch(/^SELECT \*, revenue/);
    expect(chain.mainDependsOn).toEqual(['totals']);
  });

  it('reads quoted names, column lists, RECURSIVE and MATERIALIZED', () => {
    const chain = parseCteChain(
      'WITH RECURSIVE "Big One"(a, b) AS NOT MATERIALIZED (SELECT 1, 2), n AS MATERIALIZED (SELECT a FROM "big one" WHERE \'n\' <> \')\') SELECT * FROM n'
    )!;
    expect(chain.ctes.map((cte) => [cte.key, cte.ref, cte.label, cte.dependsOn])).toEqual([
      ['big one', '"Big One"', 'Big One', []],
      ['n', 'n', 'n', ['big one']],
    ]);
  });

  it('ignores names inside strings and comments', () => {
    const chain = parseCteChain("WITH a AS (SELECT 1), b AS (SELECT 'a' -- a\n /* a */ FROM range(1)) SELECT * FROM b")!;
    expect(chain.ctes[1]!.dependsOn).toEqual([]);
    expect(chain.mainDependsOn).toEqual(['b']);
  });

  it.each([['SELECT 1'], ['WITH a AS (SELECT 1'], ['WITH a (SELECT 1) SELECT 1'], ['WITH AS (SELECT 1) SELECT 1']])(
    'is null for %j',
    (sql) => {
      expect(parseCteChain(sql)).toBeNull();
    }
  );
});

describe('cteDependents', () => {
  it('follows reads through later CTEs to the main query', () => {
    const chain = parseCteChain('WITH a AS (SELECT 1), b AS (SELECT * FROM a), c AS (SELECT 2), d AS (SELECT * FROM b) SELECT * FROM c')!;
    const dependents = cteDependents(chain, 'a');
    expect([...dependents.ctes]).toEqual(['b', 'd']);
    expect(dependents.main).toBe(false);
    expect(cteDependents(chain, 'c').main).toBe(true);
  });
});

describe('planInstantPreview', () => {
  it('previews the CTE under the cursor with the CTEs before it', () => {
    const plan = planInstantPreview(SALES, SALES.indexOf('sum(orders)'))!;
    expect(plan.cte).toBe('totals');
    expect(plan.sql).toBe(
      `${SALES.slice(0, SALES.indexOf('\nSELECT *, revenue'))}\nSELECT * FROM totals LIMIT ${INSTANT_SAMPLE_ROWS}`
    );
    expect(SALES.slice(plan.range!.start, plan.range!.end)).toMatch(/^totals AS \(/);
    expect(plan.crumbs.map((crumb) => [crumb.key, crumb.active, crumb.dependent])).toEqual([
      ['cities', false, false],
      ['totals', true, false],
      ['', false, true],
    ]);
    expect(plan.crumbs[0]!.offset).toBe(SALES.indexOf('cities'));
  });

  it('previews the whole statement outside a CTE, sampled', () => {
    const buffer = 'SELECT 1;\n  SELECT x FROM range(5) t(x) -- last\n;';
    const plan = planInstantPreview(buffer, buffer.indexOf('range'))!;
    expect(plan.cte).toBeUndefined();
    expect(plan.range).toBeUndefined();
    expect(plan.crumbs).toEqual([]);
    expect(plan.sql).toBe(`SELECT * FROM (\nSELECT x FROM range(5) t(x) -- last\n) AS lingua_instant LIMIT ${INSTANT_SAMPLE_ROWS}`);
    expect(plan.targetKey).toBe('1:');
  });

  it('keys the target by statement and CTE', () => {
    const inCities = planInstantPreview(SALES, SALES.indexOf('read_csv'))!;
    const elsewhereInCities = planInstantPreview(SALES, SALES.indexOf('cities AS'))!;
    const inMain = planInstantPreview(SALES, SALES.indexOf('ORDER BY'))!;
    expect(inCities.targetKey).toBe(elsewhereInCities.targetKey);
    expect(inMain.targetKey).not.toBe(inCities.targetKey);
    expect(inMain.crumbs.at(-1)!.active).toBe(true);
  });

  it.each([
    ['DELETE FROM t', 'write'],
    ['CREATE TABLE t AS SELECT 1', 'write'],
    ['WITH a AS (SELECT 1) INSERT INTO t SELECT * FROM a', 'write'],
    ["SELECT nextval('seq')", 'side-effect'],
    ["SELECT * FROM query('SELECT 1')", 'side-effect'],
    ['SELECT setseed (0.5)', 'side-effect'],
  ])('never runs %j as you type', (sql, reason) => {
    const plan = planInstantPreview(sql, 0)!;
    expect(plan.blocked).toBe(reason);
    expect(plan.sql).toBeUndefined();
  });

  it('allows the words in strings and comments, and a URL as data', () => {
    expect(planInstantPreview("SELECT 'nextval(' AS a -- query(\n", 0)!.blocked).toBeUndefined();
    expect(planInstantPreview("SELECT 'https://lingua.dev' AS site", 0)!.blocked).toBeUndefined();
  });

  it('is null without a statement', () => {
    expect(planInstantPreview('  -- nothing\n', 3)).toBeNull();
  });
});

// Shapes as DuckDB 1.32's json_serialize_sql returns them.
const constant = (value: unknown) => ({ class: 'CONSTANT', type: 'VALUE_CONSTANT', value: { type: { id: 'VARCHAR' }, is_null: false, value } });
const call = (name: string, children: unknown[], schema = '') => ({ class: 'FUNCTION', type: 'FUNCTION', function_name: name, schema, children });
const option = (value: unknown) => ({ class: 'COMPARISON', type: 'COMPARE_EQUAL', left: { class: 'COLUMN_REF' }, right: value });
const scan = (fn: unknown) => [{ node: { type: 'SELECT_NODE', from_table: { type: 'TABLE_FUNCTION', function: fn } } }];
const concat = call('||', [constant('ht'), constant('tps://x/a.csv')]);

describe('instantAstBlockReason', () => {
  it.each([
    ['a quoted or qualified side-effect call', [{ node: { select_list: [call('nextval', [constant('s')], 'main')] } }], 'side-effect'],
    ['the query table function', scan(call('query', [constant('SELECT 1')])), 'side-effect'],
    ['a path built by concatenation', scan(call('read_csv', [call('||', [constant('ht'), constant('tps://x/a.csv')])])), 'computed-path'],
    ['a remote path', scan(call('read_parquet', [constant('https://x/a.parquet')])), 'remote'],
    ['a remote path in a list', scan(call('read_parquet', [call('list_value', [constant('a.parquet'), constant('az://c/b.parquet')], 'main')])), 'remote'],
    ['a remote replacement scan', [{ node: { from_table: { type: 'BASE_TABLE', table_name: 'https://x/a.csv' } } }], 'remote'],
    ['a remote table name on another ref', [{ node: { from_table: { type: 'SHOW_REF', table_name: 's3://b/a.parquet' } } }], 'remote'],
    ['a remote URL passed to any function', [{ node: { select_list: [call('st_read', [constant('https://x/a.geojson')])] } }], 'remote'],
    ['a computed argument to an unknown table function', scan(call('st_read', [concat])), 'computed-path'],
    ['SQL run from a serialized plan', [{ node: { select_list: [call('json_execute_serialized_sql', [constant('{}')])] } }], 'side-effect'],
  ])('blocks %s', (_name, ast, reason) => {
    expect(instantAstBlockReason(ast)).toBe(reason);
  });

  it.each([
    ['a local file with options', scan(call('read_csv', [constant('a.csv'), option(constant(';')), option(call('||', [constant('ht'), constant('tps://x')]))]))],
    ['local files in a list', scan(call('read_parquet', [call('list_value', [constant('a.parquet'), constant('b.parquet')], 'main')]))],
    ['a computed range', scan(call('range', [call('+', [constant(1), constant(2)])]))],
    ['an unnest of a computed list', scan(call('unnest', [call('list_value', [call('+', [constant(1), constant(2)])])]))],
    ['a URL as data', [{ node: { select_list: [constant('https://lingua.dev')] } }]],
    ['a local table', [{ node: { from_table: { type: 'BASE_TABLE', table_name: 'sales' } } }]],
  ])('allows %s', (_name, ast) => {
    expect(instantAstBlockReason(ast)).toBeUndefined();
  });
});
