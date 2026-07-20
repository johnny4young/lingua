/**
 * implementation — Build a `RunCapsuleV1` from a SQL query + response
 * pair. Mirror of `httpResponseCapsule.ts` so the SQL workspace
 * inherits the same share / CLI / AI / export contract.
 *
 * Mapping rules:
 *
 *   - `tab.language = 'sql'` — distinguishes SQL capsules from
 *     `'javascript'` / `'python'` / `'http'` so the consumer can
 *     render them with the right surface.
 *   - `tab.runtimeMode = 'duckdb-wasm'` +
 *     `environment.runner = 'duckdb-wasm'` — reserved literal that
 *     the existing capsule shape allows.
 *   - `source.content` carries the user-authored query text verbatim.
 *     The content-hash on that string lets the consumer dedup
 *     repeated runs.
 *   - `result.status` maps SQL outcome to capsule outcome:
 *     `success` → `'success'`, `timeout` → `'timeout'`,
 *     everything else → `'error'`.
 *   - `result.stdout` carries the result row preview as JSON.
 *   - `result.stderr` carries the error message (when present).
 *   - `result.durationMs` mirrors the SQL response's duration.
 *
 * The existing capsule sanitiser (`sanitizeRunCapsule`) handles
 * additional defense-in-depth redaction so the EXPORTED capsule
 * never carries surprise PII even if the renderer somehow recorded
 * it.
 */

import {
  buildRunCapsule,
  type RunCapsuleStatus,
  type RunCapsuleV1,
} from '../../shared/runCapsule';
import type { SqlQueryV1, SqlResponseV1 } from '../../shared/sqlWorkspace';

/**
 * Map the SQL response status to the capsule status enum.
 */
function mapSqlStatusToCapsule(status: SqlResponseV1['status']): RunCapsuleStatus {
  if (status === 'timeout') return 'timeout';
  if (status === 'success') return 'success';
  // sql-error / too-large / engine-load-failed all surface as
  // 'error' from the capsule's POV — the raw SQL status is still
  // available on the wrapped response payload for any consumer
  // that wants to dispatch on it.
  return 'error';
}

/**
 * Best-effort JSON-stringify the row preview for `result.stdout`.
 * Pretty-printed (2-space indent) so a human opening the capsule in
 * a text editor can read the rows. The capsule sanitiser truncates
 * if needed.
 */
function serializeRowsForStdout(response: SqlResponseV1): string {
  if (response.rows.length === 0) return '';
  try {
    return JSON.stringify(response.rows, null, 2);
  } catch {
    // Defensive — should not happen because the renderer already
    // ran the rows through a JSON-serialisable sanitiser. If it
    // does, surface an honest empty body rather than crash.
    return '';
  }
}

export interface BuildSqlResponseCapsuleInput {
  appVersion: string;
  query: SqlQueryV1;
  response: SqlResponseV1;
  platform: 'web' | 'desktop';
}

/**
 * Build a capsule for a SQL exchange. Delegates the content-hashing
 * + UUID generation + ISO timestamp to the existing `buildRunCapsule`
 * helper so SQL capsules share every guarantee with code-run and
 * HTTP-run capsules.
 */
export async function buildSqlResponseCapsule(
  input: BuildSqlResponseCapsuleInput
): Promise<RunCapsuleV1> {
  const status = mapSqlStatusToCapsule(input.response.status);
  const stdout = serializeRowsForStdout(input.response);
  return buildRunCapsule({
    appVersion: input.appVersion,
    tab: {
      name: input.query.name.length > 0 ? input.query.name : 'SQL query',
      language: 'sql',
      runtimeMode: 'duckdb-wasm',
      workflowMode: 'run',
    },
    source: { content: input.query.query },
    result: {
      status,
      durationMs: Math.max(0, input.response.durationMs),
      ...(stdout.length > 0 ? { stdout } : {}),
      ...(input.response.errorMessage !== undefined
        ? { stderr: input.response.errorMessage }
        : {}),
    },
    environment: {
      platform: input.platform,
      runner: 'duckdb-wasm',
    },
  });
}
