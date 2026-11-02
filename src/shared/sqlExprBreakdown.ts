/**
 * Instant SQL's expression breakdown: splits a computed column of the
 * previewed SELECT into its sub-expressions, using DuckDB's own parse, and
 * builds the SQL that counts where each one is NULL or a divisor is zero.
 */

import { functionName, isAstNode, type AstNode } from './sqlCtePreview';
import { skipSqlToken } from './sqlStatements';

export const BREAKDOWN_MAX_NODES = 32;
// Every part repeats its whole expression in the select list, and DuckDB's planning time grows much faster than that text.
const BREAKDOWN_MAX_WEIGHT = 2000;
const MAX_JSON_DEPTH = 800;

const ALIAS_PREFIX = 'lingua_e';
const AGGREGATE =
  /^(?:sum|sum_no_overflow|fsum|sumkahan|kahan_sum|count|count_star|count_if|countif|avg|favg|mean|geomean|geometric_mean|min|max|median|mode|mad|sem|stddev\w*|var\w*|first|last|any_value|arbitrary|arg_min\w*|arg_max\w*|argmin|argmax|min_by|max_by|list|array_agg|string_agg|group_concat|listagg|quantile\w*|approx_\w+|bool_and|bool_or|bit_and|bit_or|bit_xor|bitstring_agg|entropy|product|histogram|histogram_exact|corr|covar\w*|kurtosis\w*|skewness|regr_\w+|reservoir_quantile|weighted_avg)$/;
const WHOLE_DIVISION = '//';

/** json_serialize_sql text as data; JSON.parse would round a u64 location that json_deserialize_sql then refuses. */
export function parseSerializedSql(raw: string): unknown {
  return JSON.parse(withoutHugeLocations(raw));
}

const withoutHugeLocations = (raw: string) => raw.replace(/"query_location":\d{19,}/g, '"query_location":0');

/**
 * False when the breakdown could not work from this parse: a number with more
 * digits than JSON.parse keeps would rebuild into different SQL, and nesting
 * this deep would overflow the stack walking it during a render.
 */
export function serializedSqlCanRebuild(raw: string): boolean {
  const code = withoutHugeLocations(raw).replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const numbers = code.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.some((text) => text.replace('.', '').replace(/^0+/, '').length > 15)) return false;
  let depth = 0;
  for (const ch of code) {
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    if (depth > MAX_JSON_DEPTH) return false;
  }
  return true;
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
const containsStar = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsStar);
  return isAstNode(value) && (value['class'] === 'STAR' || Object.values(value).some(containsStar));
};

/**
 * The computed columns of `source` found in the result. With a star the
 * positions shift, so only an alias identifies a column. DISTINCT has none:
 * the extra sub-expressions would change which rows are distinct.
 */
export function computedColumns(source: AstNode, resultColumns: ReadonlyArray<string>): BreakdownColumn[] {
  if (records(source['modifiers']).some((modifier) => modifier['type'] === 'DISTINCT_MODIFIER')) return [];
  // A column with our prefix would answer for a part's counts.
  if (resultColumns.some((name) => name.toLowerCase().startsWith(ALIAS_PREFIX))) return [];
  const list = selectList(source);
  const hasStar = containsStar(list);
  const columns: BreakdownColumn[] = [];
  list.forEach((item, index) => {
    // `COLUMNS(*) + 1` is many columns, not one.
    if (NOT_COMPUTED.has(String(item['class'])) || containsStar(item)) return;
    const alias = typeof item['alias'] === 'string' && item['alias'] !== '' ? item['alias'] : undefined;
    const column = alias ?? (hasStar ? undefined : resultColumns[index]);
    if (column !== undefined && resultColumns.includes(column)) columns.push({ column, expr: item });
  });
  return columns;
}

export interface BreakdownNode {
  expr: AstNode;
  depth: number;
  /** Position of the node this one is part of; unset on the column itself. */
  parent?: number;
  /** Set on a divisor: what its parent becomes when it is zero. */
  zeroGives?: 'not-finite' | 'null';
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

const astWeight = (value: unknown): number => {
  if (Array.isArray(value)) return value.reduce((total: number, item) => total + astWeight(item), 0);
  return isAstNode(value) ? ('class' in value ? 1 : 0) + astWeight(Object.values(value)) : 0;
};

/** The expression and what it is made of, parents first, up to `BREAKDOWN_MAX_NODES` and the weight budget. */
export function buildBreakdownTree(source: AstNode, expr: AstNode): BreakdownNode[] {
  // GROUP BY ALL groups by whatever is selected, so an extra operand would regroup the rows.
  if (source['aggregate_handling'] === 'FORCE_AGGREGATES') return [{ expr, depth: 0 }];
  const grouped = isGrouped(source);
  const nodes: BreakdownNode[] = [];
  let weight = 0;
  const visit = (node: AstNode, depth: number, parent?: number, zeroGives?: BreakdownNode['zeroGives']) => {
    if (nodes.length >= BREAKDOWN_MAX_NODES) return;
    weight += astWeight(node);
    if (nodes.length > 0 && weight > BREAKDOWN_MAX_WEIGHT) return;
    const position = nodes.length;
    nodes.push({ expr: node, depth, ...(parent !== undefined ? { parent } : {}), ...(zeroGives ? { zeroGives } : {}) });
    const name = node['class'] === 'FUNCTION' && node['is_operator'] === true ? functionName(node) : '';
    operands(node, grouped).forEach((operand, index) => {
      if (!isAstNode(operand) || operand['class'] === 'CONSTANT') return;
      const divisor = index === 1 && (name === '/' || name === WHOLE_DIVISION);
      visit(operand, depth + 1, position, divisor ? (name === '/' ? 'not-finite' : 'null') : undefined);
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
  const inner = { ...source, select_list: [...selectList(source), ...nodes.map((node, index) => ({ ...node.expr, alias: aliasOf(index) }))] };
  const labels = nodes.map((node, index) => {
    const shell: AstNode = {
      ...source,
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
  return wrappedWhole(text) ? text.slice(1, -1) : text;
}

/** True when the first parenthesis closes at the very end, quoted text aside. */
function wrappedWhole(text: string): boolean {
  if (!text.startsWith('(') || !text.endsWith(')')) return false;
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    const skipped = skipSqlToken(text, index);
    if (skipped !== -1) {
      index = skipped;
      continue;
    }
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return index === text.length - 1;
    }
    index += 1;
  }
  return false;
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
