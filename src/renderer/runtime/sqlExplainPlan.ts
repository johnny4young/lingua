import { isReadOnlySqlStatement } from '../../shared/sqlStatements';

export interface SqlPlanNode {
  id: string;
  name: string;
  /** Operator time in ms; only on an analyzed plan. */
  timingMs?: number;
  /** Rows the operator produced (analyzed) or expected (estimated). */
  rows?: number;
  details: string[];
  children: SqlPlanNode[];
}

export interface SqlPlan {
  /** True when the plan comes from EXPLAIN ANALYZE, with real times and rows. */
  analyzed: boolean;
  roots: SqlPlanNode[];
  totalMs?: number;
  peakMemoryBytes?: number;
}

/** Asks DuckDB's own parser whether the text is exactly one SELECT, so no hidden statement rides along. */
export function buildSingleSelectCheckSql(statement: string): string {
  return `SELECT json_serialize_sql('${statement.replaceAll("'", "''")}') AS j`;
}

export function isSingleSelect(rows: ReadonlyArray<Record<string, unknown>>): boolean {
  try {
    const parsed: unknown = JSON.parse(String(rows[0]?.['j']));
    return isRecord(parsed) && parsed['error'] === false && Array.isArray(parsed['statements']) && parsed['statements'].length === 1;
  } catch {
    return false;
  }
}

/** ANALYZE executes the statement, so it needs DuckDB's single-SELECT check and the read-only check. */
export function buildExplainSql(statement: string, singleSelect: boolean): { sql: string; analyzed: boolean } {
  const body = statement.trim().replace(/;\s*$/, '');
  const analyzed = singleSelect && isReadOnlySqlStatement(body);
  return { sql: `EXPLAIN (${analyzed ? 'ANALYZE, ' : ''}FORMAT JSON) ${body}`, analyzed };
}

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

function detailLines(extra: unknown): { details: string[]; estimated?: number } {
  if (!isRecord(extra)) return { details: [] };
  const details: string[] = [];
  let estimated: number | undefined;
  for (const [key, value] of Object.entries(extra)) {
    if (key === 'Estimated Cardinality') {
      estimated = finiteNumber(value);
      continue;
    }
    const text = Array.isArray(value)
      ? value.map(String).join(', ')
      : isRecord(value)
        ? JSON.stringify(value)
        : String(value);
    if (text.trim().length > 0) details.push(`${key}: ${text}`);
  }
  return { details, estimated };
}

/** Projections DuckDB adds to (de)compress columns: internal calls plus bare `#N` passthroughs. */
function isInternalProjection(name: string, extra: unknown): boolean {
  if (name !== 'PROJECTION' || !isRecord(extra)) return false;
  const projections = extra['Projections'];
  const list = (Array.isArray(projections) ? projections : [projections]).map(String);
  return (
    list.some((item) => item.includes('__internal_')) &&
    list.every((item) => item.includes('__internal_') || /^#\d+$/.test(item.trim()))
  );
}

function toNodes(value: unknown, analyzed: boolean, path: string): SqlPlanNode[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => toNodes(item, analyzed, `${path}.${index}`));
  if (!isRecord(value)) return [];
  const name = String(value['operator_name'] ?? value['operator_type'] ?? value['name'] ?? '').trim();
  const children = toNodes(value['children'], analyzed, path);
  if (name === '' || name === 'EXPLAIN_ANALYZE' || isInternalProjection(name, value['extra_info'])) {
    return children;
  }
  const { details, estimated } = detailLines(value['extra_info']);
  const timing = finiteNumber(value['operator_timing']);
  const cardinality = finiteNumber(value['operator_cardinality']);
  const rows = analyzed ? (cardinality ?? estimated) : estimated;
  return [
    {
      id: path,
      name,
      ...(analyzed && timing !== undefined ? { timingMs: timing * 1000 } : {}),
      ...(rows !== undefined ? { rows } : {}),
      details,
      children,
    },
  ];
}

/** Seconds across every operator, hidden ones included, so the total matches the engine's work. */
function sumRawTiming(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total: number, item) => total + sumRawTiming(item), 0);
  if (!isRecord(value)) return 0;
  return (finiteNumber(value['operator_timing']) ?? 0) + sumRawTiming(value['children']);
}

/** Reads the `explain_value` JSON of an EXPLAIN (FORMAT JSON) result; null when it is not a plan. */
export function parseExplainRows(rows: ReadonlyArray<Record<string, unknown>>, analyzed: boolean): SqlPlan | null {
  const raw = rows[0]?.['explain_value'];
  if (typeof raw !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const roots = toNodes(isRecord(json) ? json['children'] : json, analyzed, 'n');
  if (roots.length === 0) return null;
  if (!analyzed) return { analyzed, roots };
  const top = isRecord(json) ? json : {};
  const latency = finiteNumber(top['latency']);
  const peak = finiteNumber(top['system_peak_buffer_memory']);
  return {
    analyzed,
    roots,
    totalMs: (latency !== undefined && latency > 0 ? latency : sumRawTiming(json)) * 1000,
    ...(peak !== undefined && peak > 0 ? { peakMemoryBytes: peak } : {}),
  };
}

export function flattenPlan(
  nodes: ReadonlyArray<SqlPlanNode>,
  depth = 0
): Array<{ node: SqlPlanNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenPlan(node.children, depth + 1)]);
}

/** The analyzed operator that took longest, or null without timings. */
export function slowestPlanNode(plan: SqlPlan): SqlPlanNode | null {
  let slowest: SqlPlanNode | null = null;
  for (const { node } of flattenPlan(plan.roots)) {
    if (node.timingMs !== undefined && node.timingMs > (slowest?.timingMs ?? 0)) slowest = node;
  }
  return slowest;
}

const formatMs = (ms: number) => `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`;

/** Indented text for Copy plan as text. */
export function planToText(plan: SqlPlan): string {
  const lines = flattenPlan(plan.roots).map(({ node, depth }) => {
    const facts = [
      node.timingMs !== undefined ? formatMs(node.timingMs) : null,
      node.rows !== undefined ? `${plan.analyzed ? '' : '~'}${node.rows} rows` : null,
    ].filter(Boolean);
    const head = `${'  '.repeat(depth)}${node.name}${facts.length > 0 ? ` (${facts.join(', ')})` : ''}`;
    return [head, ...node.details.map((detail) => `${'  '.repeat(depth + 1)}${detail}`)].join('\n');
  });
  if (plan.totalMs !== undefined) lines.push(`Total: ${formatMs(plan.totalMs)}`);
  return lines.join('\n');
}

export { formatMs as formatPlanMs };
