/**
 * Instant SQL's expression breakdown: splits a computed column of the
 * previewed SELECT into its sub-expressions, using DuckDB's own parse, and
 * builds the SQL that counts where each one is NULL or a divisor is zero.
 */

import { functionName, isAstNode, type AstNode } from './sqlCtePreview';

export const BREAKDOWN_MAX_NODES = 32;

const ALIAS_PREFIX = 'lingua_e';
const AGGREGATE =
  /^(?:sum|fsum|sumkahan|kahan_sum|count|count_star|avg|favg|mean|min|max|median|mode|stddev\w*|var\w*|first|last|any_value|arg_min\w*|arg_max\w*|min_by|max_by|list|array_agg|string_agg|group_concat|listagg|quantile\w*|approx_\w+|bool_and|bool_or|bit_and|bit_or|bit_xor|bitstring_agg|entropy|product|histogram|corr|covar\w*|kurtosis\w*|skewness|regr_\w+|reservoir_quantile|weighted_avg)$/;
const WHOLE_DIVISION = '//';

/** json_serialize_sql text as data; JSON.parse would round a u64 location that json_deserialize_sql then refuses. */
export function parseSerializedSql(raw: string): unknown {
  return JSON.parse(raw.replace(/"query_location":\d{19,}/g, '"query_location":0'));
}

const clone = <T>(value: T): T => structuredClone(value);
const records = (value: unknown): AstNode[] => (Array.isArray(value) ? value.filter(isAstNode) : []);
const selectList = (node: AstNode) => records(node['select_list']);
const isSelectNode = (node: unknown): node is AstNode => isAstNode(node) && node['type'] === 'SELECT_NODE';

/**
 * The SELECT the sampled SQL previews, from its parse: the CTE `cte` with the
 * CTEs before it, or the statement inside the sample's wrapper. Null for a
 * UNION or a recursive CTE, which have no single select list.
 */
export function breakdownSource(statements: unknown, cte?: string): AstNode | null {
  const statement = Array.isArray(statements) && isAstNode(statements[0]) ? statements[0]['node'] : null;
  if (!isAstNode(statement)) return null;
  if (cte === undefined) {
    const from = statement['from_table'];
    const inner = isAstNode(from) && from['type'] === 'SUBQUERY' && isAstNode(from['subquery']) ? from['subquery']['node'] : null;
    return isSelectNode(inner) ? clone(inner) : null;
  }
  const map = isAstNode(statement['cte_map']) ? records(statement['cte_map']['map']) : [];
  const index = map.findIndex((entry) => String(entry['key']).toLowerCase() === cte.toLowerCase());
  const value = map[index]?.['value'];
  const query = isAstNode(value) ? value['query'] : null;
  const node = isAstNode(query) ? query['node'] : null;
  if (!isSelectNode(node)) return null;
  const source = clone(node);
  const own = isAstNode(source['cte_map']) ? records(source['cte_map']['map']) : [];
  source['cte_map'] = { map: [...clone(map.slice(0, index)), ...own] };
  return source;
}

export interface BreakdownColumn {
  /** The result column this expression fills. */
  column: string;
  expr: AstNode;
}

const NOT_COMPUTED = new Set(['COLUMN_REF', 'STAR', 'CONSTANT']);

/**
 * The computed columns of `source` found in the result. With a star the
 * positions shift, so only an alias identifies a column. DISTINCT has none:
 * the extra sub-expressions would change which rows are distinct.
 */
export function computedColumns(source: AstNode, resultColumns: ReadonlyArray<string>): BreakdownColumn[] {
  if (records(source['modifiers']).some((modifier) => modifier['type'] === 'DISTINCT_MODIFIER')) return [];
  const list = selectList(source);
  const hasStar = list.some((item) => item['class'] === 'STAR');
  const columns: BreakdownColumn[] = [];
  list.forEach((item, index) => {
    if (NOT_COMPUTED.has(String(item['class']))) return;
    const alias = typeof item['alias'] === 'string' && item['alias'] !== '' ? item['alias'] : undefined;
    const column = alias ?? (hasStar ? undefined : resultColumns[index]);
    if (column !== undefined && resultColumns.includes(column)) columns.push({ column, expr: item });
  });
  return columns;
}

export interface BreakdownNode {
  expr: AstNode;
  depth: number;
  /** Set on a divisor: what its parent becomes when it is zero. */
  zeroGives?: 'infinity' | 'null';
}

const isGrouped = (source: AstNode) =>
  records(source['group_expressions']).length > 0 || source['aggregate_handling'] !== 'STANDARD_HANDLING';

function operands(expr: AstNode, grouped: boolean): unknown[] {
  switch (expr['class']) {
    case 'FUNCTION': {
      // Under GROUP BY a function's argument may not be selectable on its own.
      if (AGGREGATE.test(functionName(expr)) || (grouped && expr['is_operator'] !== true)) return [];
      return records(expr['children']);
    }
    case 'OPERATOR':
    case 'CONJUNCTION':
      return records(expr['children']);
    case 'CAST':
      return [expr['child']];
    case 'COMPARISON':
      return [expr['left'], expr['right']];
    default:
      return [];
  }
}

/** The expression and what it is made of, parents first, up to `BREAKDOWN_MAX_NODES`. */
export function buildBreakdownTree(source: AstNode, expr: AstNode): BreakdownNode[] {
  const grouped = isGrouped(source);
  const nodes: BreakdownNode[] = [];
  const visit = (node: AstNode, depth: number, zeroGives?: BreakdownNode['zeroGives']) => {
    if (nodes.length >= BREAKDOWN_MAX_NODES) return;
    nodes.push({ expr: node, depth, ...(zeroGives ? { zeroGives } : {}) });
    const name = node['class'] === 'FUNCTION' && node['is_operator'] === true ? functionName(node) : '';
    operands(node, grouped).forEach((operand, index) => {
      if (!isAstNode(operand) || operand['class'] === 'CONSTANT') return;
      const divisor = index === 1 && (name === '/' || name === WHOLE_DIVISION);
      visit(operand, depth + 1, divisor ? (name === '/' ? 'infinity' : 'null') : undefined);
    });
  };
  visit(expr, 0);
  return nodes;
}

const aliasOf = (index: number) => `${ALIAS_PREFIX}${index}`;
const sqlString = (text: string) => `'${text.replaceAll("'", "''")}'`;
const deserialize = (node: AstNode) => `json_deserialize_sql(${sqlString(JSON.stringify({ error: false, statements: [{ node, named_param_map: [] }] }))})`;

/** One query that turns the parse back into SQL: `inner_sql`, the source with every node as an extra column, and `label_N` for each node. */
export function buildBreakdownRebuildSql(source: AstNode, nodes: ReadonlyArray<BreakdownNode>): string {
  const inner = clone(source);
  inner['select_list'] = [...selectList(source), ...nodes.map((node, index) => ({ ...node.expr, alias: aliasOf(index) }))];
  const labels = nodes.map((node, index) => {
    const shell: AstNode = {
      ...clone(source),
      select_list: [{ ...node.expr, alias: '' }],
      from_table: { type: 'EMPTY', alias: '', sample: null, query_location: 0 },
      cte_map: { map: [] },
      modifiers: [],
      where_clause: null,
      group_expressions: [],
      group_sets: [],
      aggregate_handling: 'STANDARD_HANDLING',
      having: null,
      sample: null,
      qualify: null,
    };
    return `${deserialize(shell)} AS label_${index}`;
  });
  return `SELECT ${deserialize(inner)} AS inner_sql, ${labels.join(', ')}`;
}

/** `SELECT (a / b)` as DuckDB prints it, down to `a / b`. */
export function breakdownLabel(rebuilt: string): string {
  const text = rebuilt.replace(/^SELECT\s+/i, '').trim();
  return text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1) : text;
}

const sampled = (innerSql: string, limit: number) => `SELECT * FROM (\n${innerSql}\n) LIMIT ${limit}`;
const isZero = (index: number) => `TRY_CAST(${aliasOf(index)} AS DOUBLE) = 0`;

/** Counts over the same sample the strip shows: `total`, `nulls_N` and, for a divisor, `zeros_N`. */
export function buildBreakdownCountsSql(innerSql: string, nodes: ReadonlyArray<BreakdownNode>, limit: number): string {
  const counts = nodes.flatMap((node, index) => [
    `count(*) FILTER (WHERE ${aliasOf(index)} IS NULL) AS nulls_${index}`,
    ...(node.zeroGives ? [`count(*) FILTER (WHERE ${isZero(index)}) AS zeros_${index}`] : []),
  ]);
  return `SELECT ${['count(*) AS total', ...counts].join(', ')} FROM (\n${sampled(innerSql, limit)}\n)`;
}

/** The sample rows where node `index` is NULL (or zero, for a divisor), without the extra columns. */
export function buildBreakdownRowsSql(innerSql: string, nodes: ReadonlyArray<BreakdownNode>, index: number, limit: number): string {
  const aliases = nodes.map((_, position) => aliasOf(position)).join(', ');
  const zero = nodes[index]?.zeroGives ? ` OR ${isZero(index)}` : '';
  return `SELECT * EXCLUDE (${aliases}) FROM (\n${sampled(innerSql, limit)}\n) WHERE ${aliasOf(index)} IS NULL${zero}`;
}
