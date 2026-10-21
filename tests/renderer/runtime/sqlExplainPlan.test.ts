import { describe, expect, it } from 'vitest';
import {
  buildExplainSql,
  buildSingleSelectCheckSql,
  isSingleSelect,
  flattenPlan,
  parseExplainRows,
  planToText,
  slowestPlanNode,
} from '../../../src/renderer/runtime/sqlExplainPlan';

// Shape of DuckDB 1.4 EXPLAIN (ANALYZE, FORMAT JSON), trimmed.
const analyzedJson = {
  latency: 0,
  system_peak_buffer_memory: 0,
  children: [
    {
      operator_name: 'EXPLAIN_ANALYZE',
      operator_timing: 0,
      children: [
        {
          operator_name: 'HASH_GROUP_BY',
          operator_timing: 0.00193,
          operator_cardinality: 3,
          extra_info: { Groups: '#0', Aggregates: 'count_star()', 'Estimated Cardinality': '500' },
          children: [
            {
              operator_name: 'PROJECTION',
              operator_timing: 0.0001,
              operator_cardinality: 1000,
              extra_info: { Projections: ['__internal_decompress_string(#0)', '#1'] },
              children: [
                {
                  operator_name: 'TABLE_SCAN',
                  operator_timing: 0.000705,
                  operator_cardinality: 1000,
                  extra_info: { Table: 'orders', Projections: ['city', 'total'] },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const plainJson = [
  {
    name: 'PROJECTION',
    extra_info: { Projections: 'city', 'Estimated Cardinality': '1000' },
    children: [{ name: 'SEQ_SCAN ', extra_info: { Table: 'orders' }, children: [] }],
  },
];

const rows = (json: unknown, key: string) => [{ explain_key: key, explain_value: JSON.stringify(json) }];

describe('buildExplainSql', () => {
  it('analyzes only a single SELECT that reads, and only plans the rest', () => {
    expect(buildExplainSql('SELECT 1;', true)).toEqual({ sql: 'EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1', analyzed: true });
    expect(buildExplainSql('SELECT 1', false)).toEqual({ sql: 'EXPLAIN (FORMAT JSON) SELECT 1', analyzed: false });
    expect(buildExplainSql('DELETE FROM t', true)).toEqual({ sql: 'EXPLAIN (FORMAT JSON) DELETE FROM t', analyzed: false });
  });
});

describe('the single-SELECT check', () => {
  it('quotes the statement as one string literal', () => {
    expect(buildSingleSelectCheckSql("SELECT 'it''s'")).toBe("SELECT json_serialize_sql('SELECT ''it''''s''') AS j");
  });

  it.each([
    ['{"error":false,"statements":[{}]}', true],
    ['{"error":false,"statements":[{},{}]}', false],
    ['{"error":true,"error_message":"Only SELECT statements can be serialized to json!"}', false],
    ['not json', false],
  ])('reads %s as %s', (json, expected) => {
    expect(isSingleSelect([{ j: json }])).toBe(expected);
  });
});

describe('parseExplainRows', () => {
  it('reads an analyzed plan without the wrapper and the internal projections', () => {
    const plan = parseExplainRows(rows(analyzedJson, 'analyzed_plan'), true)!;
    expect(flattenPlan(plan.roots).map(({ node, depth }) => [node.name, depth])).toEqual([
      ['HASH_GROUP_BY', 0],
      ['TABLE_SCAN', 1],
    ]);
    const [group] = plan.roots;
    expect(group).toMatchObject({ rows: 3, details: ['Groups: #0', 'Aggregates: count_star()'] });
    expect(group!.timingMs).toBeCloseTo(1.93);
    // Latency is 0 in the browser build, so the total falls back to the operator sum.
    expect(plan.totalMs).toBeCloseTo(1.93 + 0.1 + 0.705);
    expect(plan.peakMemoryBytes).toBeUndefined();
    expect(slowestPlanNode(plan)?.name).toBe('HASH_GROUP_BY');
  });

  it('reads an estimated plan with expected rows and no timings', () => {
    const plan = parseExplainRows(rows(plainJson, 'physical_plan'), false)!;
    expect(plan.analyzed).toBe(false);
    expect(plan.roots[0]).toMatchObject({ name: 'PROJECTION', rows: 1000, details: ['Projections: city'] });
    expect(plan.roots[0]!.children[0]).toMatchObject({ name: 'SEQ_SCAN', details: ['Table: orders'] });
    expect(slowestPlanNode(plan)).toBeNull();
    expect(plan.totalMs).toBeUndefined();
  });

  it('keeps a reported peak memory and latency', () => {
    const plan = parseExplainRows(
      rows({ ...analyzedJson, latency: 0.5, system_peak_buffer_memory: 2048 }, 'analyzed_plan'),
      true
    )!;
    expect(plan).toMatchObject({ totalMs: 500, peakMemoryBytes: 2048 });
  });

  it('returns null for anything that is not a plan', () => {
    expect(parseExplainRows([], true)).toBeNull();
    expect(parseExplainRows([{ explain_value: 'not json' }], true)).toBeNull();
    expect(parseExplainRows(rows([], 'physical_plan'), false)).toBeNull();
  });
});

describe('planToText', () => {
  it('indents operators with their facts and details', () => {
    const plan = parseExplainRows(rows(plainJson, 'physical_plan'), false)!;
    expect(planToText(plan)).toBe(
      ['PROJECTION (~1000 rows)', '  Projections: city', '  SEQ_SCAN', '    Table: orders'].join('\n')
    );
  });
});
