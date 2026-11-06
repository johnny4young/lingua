import type { AstNode } from '../../shared/sqlCtePreview';
import { INSTANT_SAMPLE_ROWS } from '../../shared/sqlCtePreview';
import {
  breakdownLabel,
  buildBreakdownCountsSql,
  buildBreakdownRebuildSql,
  buildBreakdownRowsSql,
  buildBreakdownTree,
  type BreakdownNode,
} from '../../shared/sqlExprBreakdown';
import { executeQuery } from './duckdbClient';
import { INSTANT_TIMEOUT_MS, runInstantPreview, type InstantPreviewResult } from './sqlInstantPreview';

export interface ExprBreakdownNode {
  label: string;
  depth: number;
  nulls: number;
  /** Rows where this divisor is zero, what it divides and what that becomes then. */
  zeros?: { rows: number; of: string; gives: NonNullable<BreakdownNode['zeroGives']> };
}

export interface ExprBreakdown {
  column: string;
  total: number;
  nodes: ExprBreakdownNode[];
  /** Runs the rows behind one node through the same gate as the preview. */
  rowsSql: (index: number) => string;
}

export type ExprBreakdownResult =
  | { kind: 'ready'; breakdown: ExprBreakdown }
  | Exclude<InstantPreviewResult, { kind: 'rows' }>;

/**
 * Rebuilds the source with every sub-expression as an extra column, then
 * counts over the sample. The generated SQL takes the preview's own path, so
 * DuckDB's parse and the safety gate judge it again. Null once `signal` aborts.
 */
export async function runExprBreakdown(source: AstNode, expr: AstNode, column: string, signal: AbortSignal): Promise<ExprBreakdownResult | null> {
  const tree = buildBreakdownTree(source, expr);
  const result = await countTree(source, tree, column, signal);
  // A part may not run alone (`a` in `GROUP BY a + b`, an unknown aggregate, a guarded cast); the column itself still can.
  return result?.kind === 'error' && tree.length > 1 ? countTree(source, tree.slice(0, 1), column, signal) : result;
}

async function countTree(source: AstNode, tree: BreakdownNode[], column: string, signal: AbortSignal): Promise<ExprBreakdownResult | null> {
  const rebuilt = await executeQuery(buildBreakdownRebuildSql(source, tree), { timeoutMs: INSTANT_TIMEOUT_MS, signal });
  if (signal.aborted || rebuilt.status === 'cancelled') return null;
  if (rebuilt.status === 'timeout') return { kind: 'timeout', ...(rebuilt.stillRunning ? { stuck: true } : {}) };
  const row = rebuilt.rows[0];
  const innerSql = row?.['inner_sql'];
  if (rebuilt.status !== 'success' || typeof innerSql !== 'string') {
    return { kind: 'error', message: rebuilt.errorMessage ?? rebuilt.status };
  }
  const counted = await runInstantPreview(buildBreakdownCountsSql(innerSql, tree, INSTANT_SAMPLE_ROWS), signal);
  if (!counted || counted.kind !== 'rows') return counted;
  const counts = counted.rows[0] ?? {};
  const labelOf = (index: number) => breakdownLabel(String(row?.[`label_${index}`] ?? ''));
  return {
    kind: 'ready',
    breakdown: {
      column,
      total: Number(counts['total'] ?? 0),
      nodes: tree.map((node, index) => ({
        label: labelOf(index),
        depth: node.depth,
        nulls: Number(counts[`nulls_${index}`] ?? 0),
        ...(node.zeroGives
          ? { zeros: { rows: Number(counts[`zeros_${index}`] ?? 0), of: node.parent === 0 ? column : labelOf(node.parent ?? 0), gives: node.zeroGives } }
          : {}),
      })),
      rowsSql: (index) => buildBreakdownRowsSql(innerSql, tree, index, INSTANT_SAMPLE_ROWS),
    },
  };
}
