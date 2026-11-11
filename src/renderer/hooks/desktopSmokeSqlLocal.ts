/**
 * Desktop smoke case for Local SQL, run only when the harness asks for it with
 * `LINGUA_DESKTOP_SMOKE_SQL_LOCAL=native|wasm`. It proves the chosen engine
 * starts inside the app and records typical and heavy query timings on five
 * million rows, with per-process memory kept apart from the smoke's budget.
 */

import { MAX_QUERY_TIMEOUT_MS } from '../../shared/sqlWorkspace';
import { useSettingsStore } from '../stores/settingsStore';

const ROWS = 5_000_000;
const REPEATS = 3;

/** Typical queries first, then the heavy ones from the WASM-versus-native benchmark. */
const QUERIES: ReadonlyArray<{ id: string; sql: string; repeat?: boolean }> = [
  { id: 'start', sql: 'SELECT 42 AS answer' },
  { id: 'typical-small', sql: 'SELECT n, n * n AS square FROM range(1000) t(n) WHERE n % 7 = 0', repeat: true },
  {
    id: 'load-5m',
    sql: `CREATE OR REPLACE TABLE smoke_bench AS SELECT range AS id, range % 1000 AS g, (range * 7919) % 100000 AS v, 'k' || (range % 5000)::VARCHAR AS k FROM range(${ROWS})`,
  },
  { id: 'preview-scan', sql: 'SELECT * FROM smoke_bench', repeat: true },
  { id: 'group-by', sql: 'SELECT g, count(*) AS n, sum(v) AS s FROM smoke_bench GROUP BY g ORDER BY g', repeat: true },
  {
    id: 'join-aggregate',
    sql: 'SELECT a.g, count(*) AS n FROM smoke_bench a JOIN (SELECT g, avg(v) AS av FROM smoke_bench GROUP BY g) b USING (g) WHERE a.v > b.av GROUP BY a.g ORDER BY n DESC, a.g LIMIT 20',
    repeat: true,
  },
  { id: 'order-limit', sql: 'SELECT * FROM smoke_bench ORDER BY v DESC, id LIMIT 100', repeat: true },
  { id: 'group-text', sql: 'SELECT k, count(*) AS n FROM smoke_bench GROUP BY k ORDER BY n DESC, k LIMIT 20', repeat: true },
  {
    id: 'window',
    sql: 'SELECT g, id, sum(v) OVER (PARTITION BY g ORDER BY id ROWS BETWEEN 10 PRECEDING AND CURRENT ROW) AS s FROM smoke_bench QUALIFY id % 100000 = 0 ORDER BY id',
    repeat: true,
  },
];

export interface SqlLocalSmokeResult {
  ok: boolean;
  message: string;
  artifact: Record<string, unknown>;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;

export async function runSqlLocalSmoke(
  engine: 'native' | 'wasm',
  captureMemory: (label: string) => Promise<unknown>
): Promise<SqlLocalSmokeResult> {
  const client = await import('../runtime/duckdbClient');
  useSettingsStore.setState({ sqlWorkspaceLocalEngine: engine });
  await client.flushAndReleaseDuckDbEngine();
  const memory: unknown[] = [await captureMemory('sql-before')];
  const timings: Array<{ id: string; status: string; rowCount: number; durationMs: number[]; wallMs: number[]; medianMs: number | null; error?: string }> = [];
  let failure: string | null = null;
  for (const query of QUERIES) {
    const durationMs: number[] = [];
    const wallMs: number[] = [];
    let status = 'success';
    let rowCount = 0;
    let error: string | undefined;
    for (let run = 0; run < (query.repeat ? REPEATS : 1); run += 1) {
      const startedAt = performance.now();
      const outcome = await client.executeQuery(query.sql, { timeoutMs: MAX_QUERY_TIMEOUT_MS });
      wallMs.push(Math.round(performance.now() - startedAt));
      durationMs.push(outcome.durationMs);
      status = outcome.status;
      rowCount = outcome.rowCount;
      error = outcome.errorMessage;
      if (status !== 'success' && status !== 'too-large') break;
    }
    timings.push({ id: query.id, status, rowCount, durationMs, wallMs, medianMs: median(wallMs), ...(error ? { error } : {}) });
    if (status !== 'success' && status !== 'too-large') {
      failure = `${query.id}: ${status} ${error ?? ''}`.trim();
      break;
    }
    if (query.id === 'load-5m' || query.id === 'window') memory.push(await captureMemory(`sql-after-${query.id}`));
  }
  await client.executeQuery('DROP TABLE IF EXISTS smoke_bench');
  const resolved = client.getResolvedLocalEngine();
  const ranRequested = resolved?.engine === engine;
  const ok = failure === null && ranRequested;
  return {
    ok,
    message: ok
      ? `Local SQL ran ${QUERIES.length} queries on the ${engine} engine`
      : failure ?? `Requested the ${engine} engine but ran ${resolved?.engine ?? 'none'} (${resolved?.fallback ?? 'no fallback reason'})`,
    artifact: { generatedAt: new Date().toISOString(), requested: engine, resolved, rows: ROWS, timings, memory },
  };
}
