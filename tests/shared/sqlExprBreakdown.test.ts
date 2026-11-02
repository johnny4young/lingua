import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_MAX_NODES,
  breakdownLabel,
  breakdownSource,
  buildBreakdownCountsSql,
  buildBreakdownRebuildSql,
  buildBreakdownRowsSql,
  buildBreakdownTree,
  computedColumns,
  parseSerializedSql,
  serializedSqlCanRebuild,
} from '../../src/shared/sqlExprBreakdown';

// Shapes as DuckDB 1.4's json_serialize_sql returns them.
const column = (name: string) => ({ class: 'COLUMN_REF', type: 'COLUMN_REF', alias: '', column_names: [name] });
const constant = (value: unknown) => ({ class: 'CONSTANT', type: 'VALUE_CONSTANT', alias: '', value: { value } });
const operator = (name: string, ...children: unknown[]) => ({ class: 'FUNCTION', type: 'FUNCTION', alias: '', function_name: name, is_operator: true, children });
const call = (name: string, ...children: unknown[]) => ({ class: 'FUNCTION', type: 'FUNCTION', alias: '', function_name: name, is_operator: false, children });
const aliased = <T extends object>(expr: T, alias: string) => ({ ...expr, alias });
const select = (selectList: unknown[], patch: object = {}) => ({
  type: 'SELECT_NODE',
  modifiers: [],
  cte_map: { map: [] },
  select_list: selectList,
  group_expressions: [],
  aggregate_handling: 'STANDARD_HANDLING',
  ...patch,
});
const TICKET = aliased(operator('/', column('revenue'), column('orders')), 'ticket');

describe('parseSerializedSql', () => {
  it('keeps a u64 location that JSON numbers would round', () => {
    const parsed = parseSerializedSql('{"query_location":18446744073709551615,"text":"\\"query_location\\":18446744073709551615"}') as Record<string, unknown>;
    expect(parsed['query_location']).toBe(0);
    expect(parsed['text']).toBe('"query_location":18446744073709551615');
  });
});

describe('serializedSqlCanRebuild', () => {
  it.each([
    ['{"value":123456789012345}', true],
    ['{"value":5021.75,"query_location":0}', true],
    ['{"query_location":18446744073709551615}', true],
    ['{"value":0.000000000000000000001}', true],
    ['{"value":9007199254740993}', false],
    ['{"value":0.1234567890123456789}', false],
    ['{"text":"9007199254740993"}', true],
    ['{"text":"say \\"9007199254740993\\" twice"}', true],
    ['{"text":"[[[[{{{{"}', true],
  ])('%s', (raw, exact) => {
    expect(serializedSqlCanRebuild(raw)).toBe(exact);
  });

  it('refuses nesting too deep to walk during a render', () => {
    const nested = (depth: number) => `${'['.repeat(depth)}${']'.repeat(depth)}`;
    expect(serializedSqlCanRebuild(nested(800))).toBe(true);
    expect(serializedSqlCanRebuild(nested(801))).toBe(false);
  });
});

describe('breakdownSource', () => {
  const inner = select([TICKET]);
  const wrapped = [{ node: select([{ class: 'STAR' }], { from_table: { type: 'SUBQUERY', subquery: { node: inner } } }) }];

  it('reads the statement inside the sample wrapper', () => {
    expect(breakdownSource(wrapped)?.['select_list']).toEqual([TICKET]);
  });

  it('reads a CTE with the CTEs before it, matching its name in any case', () => {
    const entry = (key: string, node: object) => ({ key, value: { query: { node } } });
    const first = entry('Cities', select([column('a')]));
    const own = entry('inside', select([column('b')]));
    const map = [first, entry('totals', select([TICKET], { cte_map: { map: [own] } })), entry('later', select([column('c')]))];
    const source = breakdownSource([{ node: select([{ class: 'STAR' }], { cte_map: { map } }) }], 'TOTALS')!;
    expect(source['select_list']).toEqual([TICKET]);
    expect((source['cte_map'] as { map: Array<{ key: string }> }).map.map((item) => item.key)).toEqual(['Cities', 'inside']);
  });

  it('is null for a UNION, a recursive CTE, an unknown CTE or no parse', () => {
    const union = [{ node: select([], { from_table: { type: 'SUBQUERY', subquery: { node: { type: 'SET_OPERATION_NODE' } } } }) }];
    expect(breakdownSource(union)).toBeNull();
    const recursive = [{ node: select([], { cte_map: { map: [{ key: 'r', value: { query: { node: { type: 'RECURSIVE_CTE_NODE' } } } }] } }) }];
    expect(breakdownSource(recursive, 'r')).toBeNull();
    expect(breakdownSource(wrapped, 'missing')).toBeNull();
    expect(breakdownSource(undefined)).toBeNull();
  });

  it('does not share nodes with the parse', () => {
    const source = breakdownSource(wrapped)!;
    source['select_list'] = [];
    expect(inner.select_list).toEqual([TICKET]);
  });
});

describe('computedColumns', () => {
  it('finds a column by alias, or by position when there is no star', () => {
    const plain = aliased(operator('+', column('a'), constant(1)), '');
    const source = select([column('city'), TICKET, plain]);
    expect(computedColumns(source, ['city', 'ticket', '(a + 1)']).map((entry) => entry.column)).toEqual(['ticket', '(a + 1)']);
  });

  it('trusts only an alias after a star', () => {
    const plain = aliased(operator('+', column('a'), constant(1)), '');
    const source = select([{ class: 'STAR' }, TICKET, plain]);
    expect(computedColumns(source, ['a', 'ticket', '(a + 1)']).map((entry) => entry.column)).toEqual(['ticket']);
  });

  it('skips plain columns, constants and anything missing from the result', () => {
    expect(computedColumns(select([aliased(column('a'), 'b'), aliased(constant(1), 'one'), TICKET]), ['b', 'one'])).toEqual([]);
  });

  it('trusts only an alias beside a nested star, and never offers the star itself', () => {
    const star = { class: 'FUNCTION', alias: '', function_name: '+', is_operator: true, children: [{ class: 'STAR' }, constant(1)] };
    const plain = aliased(operator('/', column('a'), column('b')), '');
    expect(computedColumns(select([star, plain]), ['x', 'y', '(a / b)'])).toEqual([]);
    expect(computedColumns(select([aliased(star, 'many'), TICKET]), ['many', 'ticket']).map((entry) => entry.column)).toEqual(['ticket']);
  });

  it('offers nothing beside a column named like its own extra columns', () => {
    expect(computedColumns(select([aliased(column('a'), 'lingua_e0'), TICKET]), ['lingua_e0', 'ticket'])).toEqual([]);
    expect(computedColumns(select([{ class: 'STAR' }, TICKET]), ['LINGUA_E3', 'ticket'])).toEqual([]);
  });

  it('offers nothing under DISTINCT, whose rows the extra columns would change', () => {
    expect(computedColumns(select([TICKET], { modifiers: [{ type: 'DISTINCT_MODIFIER' }] }), ['ticket'])).toEqual([]);
  });
});

describe('buildBreakdownTree', () => {
  const shape = (nodes: ReturnType<typeof buildBreakdownTree>) => nodes.map((node) => [node.expr['function_name'] ?? (node.expr['column_names'] as string[] | undefined)?.[0] ?? node.expr['class'], node.depth]);

  it('walks parents first, skipping constants', () => {
    const expr = operator('/', { class: 'OPERATOR', type: 'OPERATOR_COALESCE', children: [column('revenue'), constant(0)] }, column('orders'));
    expect(shape(buildBreakdownTree(select([expr]), expr))).toEqual([['/', 0], ['OPERATOR', 1], ['revenue', 2], ['orders', 1]]);
  });

  it('marks a divisor with what its zero gives', () => {
    const divide = buildBreakdownTree(select([TICKET]), TICKET);
    expect(divide.map((node) => node.zeroGives)).toEqual([undefined, undefined, 'not-finite']);
    expect(divide.map((node) => node.parent)).toEqual([undefined, 0, 0]);
    const whole = operator('//', column('a'), column('b'));
    expect(buildBreakdownTree(select([whole]), whole)[2]?.zeroGives).toBe('null');
    const plus = operator('+', column('a'), column('b'));
    expect(buildBreakdownTree(select([plus]), plus).every((node) => node.zeroGives === undefined)).toBe(true);
    const constantDivisor = operator('/', column('a'), constant(0));
    expect(buildBreakdownTree(select([constantDivisor]), constantDivisor)).toHaveLength(2);
  });

  it.each(['sum', 'count', 'count_if', 'arg_max', 'argmax', 'arbitrary', 'mad', 'sem', 'geomean', 'histogram_exact', 'sum_no_overflow'])('keeps the aggregate %s whole', (name) => {
    const expr = operator('/', call(name, column('a')), call('count', column('b')));
    expect(shape(buildBreakdownTree(select([expr]), expr))).toEqual([['/', 0], [name, 1], ['count', 1]]);
  });

  it('enters scalar functions, but not under GROUP BY', () => {
    const expr = call('round', operator('/', column('a'), column('b')));
    expect(shape(buildBreakdownTree(select([expr]), expr))).toEqual([['round', 0], ['/', 1], ['a', 2], ['b', 2]]);
    expect(shape(buildBreakdownTree(select([expr], { group_expressions: [column('c')] }), expr))).toEqual([['round', 0]]);
    expect(shape(buildBreakdownTree(select([expr], { aggregate_handling: 'FORCE_AGGREGATES' }), expr))).toEqual([['round', 0]]);
  });

  it('keeps the column whole under GROUP BY ALL, which an extra operand would regroup', () => {
    expect(buildBreakdownTree(select([TICKET], { aggregate_handling: 'FORCE_AGGREGATES' }), TICKET)).toEqual([{ expr: TICKET, depth: 0 }]);
  });

  it('follows casts, comparisons and conjunctions, and stops at CASE, windows and subqueries', () => {
    const cast = { class: 'CAST', child: column('a') };
    const compare = { class: 'COMPARISON', left: cast, right: column('b') };
    const conjunction = { class: 'CONJUNCTION', children: [compare, column('c')] };
    expect(shape(buildBreakdownTree(select([conjunction]), conjunction)).map((item) => item[0])).toEqual(['CONJUNCTION', 'COMPARISON', 'CAST', 'a', 'b', 'c']);
    for (const leaf of ['CASE', 'WINDOW', 'SUBQUERY']) {
      const expr = { class: leaf, children: [column('a')] };
      expect(buildBreakdownTree(select([expr]), expr)).toHaveLength(1);
    }
  });

  it('stops early on a long chain, whose repeated copies are slow to plan, but keeps the column', () => {
    let expr: object = column('a');
    for (let index = 0; index < 300; index += 1) expr = operator('+', expr, column('b'));
    const nodes = buildBreakdownTree(select([expr]), expr as never);
    expect(nodes.length).toBeGreaterThan(1);
    expect(nodes.length).toBeLessThan(BREAKDOWN_MAX_NODES);
    let huge: object = column('a');
    for (let index = 0; index < 1100; index += 1) huge = operator('+', huge, column('b'));
    expect(buildBreakdownTree(select([huge]), huge as never)).toHaveLength(1);
  });

  it('stops at the node cap', () => {
    const expr = call('greatest', ...Array.from({ length: BREAKDOWN_MAX_NODES * 2 }, (_, index) => column(`c${index}`)));
    expect(buildBreakdownTree(select([expr]), expr)).toHaveLength(BREAKDOWN_MAX_NODES);
  });
});

describe('generated SQL', () => {
  const source = select([column('city'), TICKET]);
  const tree = buildBreakdownTree(source, TICKET);

  it('rebuilds the source with the nodes as extra columns, and one label for each', () => {
    const sql = buildBreakdownRebuildSql(source, tree);
    const parts = [...sql.matchAll(/json_deserialize_sql\('((?:[^']|'')*)'\) AS (\w+)/g)].map((match) => [match[2], JSON.parse(match[1]!.replaceAll("''", "'"))]);
    expect(parts.map((part) => part[0])).toEqual(['inner_sql', 'label_0', 'label_1', 'label_2']);
    const inner = (parts[0]![1] as { statements: Array<{ node: { select_list: Array<{ alias: string }> } }> }).statements[0]!.node;
    expect(inner.select_list.map((item) => item.alias)).toEqual(['', 'ticket', 'lingua_e0', 'lingua_e1', 'lingua_e2']);
    const label = (parts[1]![1] as { statements: Array<{ node: Record<string, unknown> }> }).statements[0]!.node;
    expect(label['from_table']).toMatchObject({ type: 'EMPTY' });
    expect(label['select_list']).toEqual([{ ...TICKET, alias: '' }]);
    expect(label['cte_map']).toEqual({ map: [] });
    expect(source.select_list).toHaveLength(2);
  });

  it('escapes quotes in the parse', () => {
    const quoted = operator('||', column('a'), constant("it's"));
    expect(buildBreakdownRebuildSql(select([quoted]), buildBreakdownTree(select([quoted]), quoted))).toContain("it''s");
  });

  it('counts NULLs for every node and zeros only for a divisor, over the sample', () => {
    const sql = buildBreakdownCountsSql('SELECT 1', tree, 1000);
    expect(sql).toBe(
      'SELECT count(*) AS total, count(*) FILTER (WHERE lingua_e0 IS NULL) AS nulls_0, count(*) FILTER (WHERE lingua_e1 IS NULL) AS nulls_1, count(*) FILTER (WHERE lingua_e2 IS NULL) AS nulls_2, count(*) FILTER (WHERE TRY_CAST(lingua_e2 AS DOUBLE) = 0) AS zeros_2 FROM (\nSELECT * FROM (\nSELECT 1\n) LIMIT 1000\n)'
    );
  });

  it('narrows to a node without the extra columns, zeros included for a divisor', () => {
    expect(buildBreakdownRowsSql('SELECT 1', tree, 1, 1000)).toBe('SELECT * EXCLUDE (lingua_e0, lingua_e1, lingua_e2) FROM (\nSELECT * FROM (\nSELECT 1\n) LIMIT 1000\n) WHERE lingua_e1 IS NULL');
    expect(buildBreakdownRowsSql('SELECT 1', tree, 2, 1000)).toContain('WHERE lingua_e2 IS NULL OR TRY_CAST(lingua_e2 AS DOUBLE) = 0');
  });

  it.each([
    ['SELECT (a / b)', 'a / b'],
    ['SELECT revenue', 'revenue'],
    ['SELECT COALESCE(a, 0)', 'COALESCE(a, 0)'],
    ['SELECT ((a + b) * c)', '(a + b) * c'],
    ['SELECT (a) + (b)', '(a) + (b)'],
    ["SELECT (a || ')') + (b)", "(a || ')') + (b)"],
    ['SELECT (a', '(a'],
    ["SELECT (a || ')')", "a || ')'"],
  ])('labels %j', (rebuilt, label) => {
    expect(breakdownLabel(rebuilt)).toBe(label);
  });
});
