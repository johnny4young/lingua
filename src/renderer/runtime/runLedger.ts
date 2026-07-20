import { executeQuery } from './duckdbClient';
import { computeContentHash } from '../../shared/runCapsule';
import type { RunCapsuleV1 } from '../../shared/runCapsule';
import { isEntitled } from '../../shared/entitlements';
import { currentEffectiveTier } from '../stores/licenseSelectors';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * internal — the Run Ledger: a local, opt-in, queryable history of the
 * user's MANUAL runs, stored in the SAME DuckDB database the SQL
 * workspace uses (schema `lingua_ledger`), so it inherits the existing
 * OPFS persistence opt-in (`sqlWorkspacePersistTables` →
 * `configureDuckDbPersistence`) and — deliberately — shows up in the SQL
 * workspace's schema browser: the user can query their own run history
 * with the product's own SQL surface.
 *
 * Privacy posture (non-negotiable):
 * - Everything is OFF by default (`runLedgerEnabled`, default false).
 * - Source code is NEVER stored in `runs` — only a SHA-256 content hash.
 * - No source, stdin, stdout/stderr, error text, diagnostics, rich output,
 *   tab name, or Git metadata reaches the ledger. An attached capsule is
 *   reduced to a metadata-only summary before it is persisted.
 * - `clearLedger()` drops the whole schema; `exportLedgerJson()` gives
 *   the user their data. The tables live in the user-visible SQL
 *   database on purpose — the user editing or dropping them is their
 *   right, not a corruption scenario.
 *
 * Retention: Free keeps 7 days of runs (pruned lazily on first use per
 * session); paid tiers (EXECUTION_HISTORY entitlement) keep everything.
 * `daily_activity` is NOT pruned — it holds only per-day counters (no
 * content) and future streak surfaces need the long tail.
 *
 * Write model: all writes funnel through one promise queue, so inserts
 * and the read-modify-write of `daily_activity` never interleave. Every
 * write is fire-and-forget and best-effort — the ledger must never make
 * a run slower or louder. `executeQuery` never throws (it settles with
 * `status: 'error'`), and a failed write triggers ONE re-ensure +
 * retry so an engine restart (SQL workspace Clear/Reconnect terminates
 * the shared engine) recreates the schema instead of silently dropping
 * every subsequent row.
 */

const FREE_RETENTION_DAYS = 7;
const RECENT_RUNS_DEFAULT_LIMIT = 50;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/u;

/** Fields deliberately omitted from the metadata-only capsule summary. Keep
 * this explicit so a future RunCapsule field cannot accidentally become
 * durable user content through a broad object spread. */
const LEDGER_CAPSULE_OMITTED_FIELDS = [
  'source.content',
  'input',
  'result.stdout',
  'result.stderr',
  'result.lineResults',
  'result.richOutputs',
  'result.diagnostics',
  'result.errorMessage',
  'environment.git',
  'tab.name',
] as const;

export interface LedgerRunInput {
  language: string;
  status: 'ok' | 'error';
  durationMs: number | null;
  /** Epoch ms when the run started/completed (history entry timestamp). */
  startedAtMs: number;
  tabId?: string | null;
  /**
   * Source text, when the surface has it (Pro history snapshot). Hashed
   * with SHA-256 before touching the database; the text itself is
   * discarded. Prefer `contentHash` when a capsule already computed it.
   */
  code?: string | null;
  /** Pre-computed SHA-256 hex (RunCapsuleV1.source.contentHash). */
  contentHash?: string | null;
  /** Capsule to reduce to metadata-only summary alongside the run row. */
  capsule?: RunCapsuleV1 | null;
}

export interface LedgerRunRow {
  runId: string;
  language: string;
  status: string;
  durationMs: number | null;
  startedAt: string;
  codeSha256: string | null;
  capsuleId: string | null;
  tabId: string | null;
}

export interface LedgerDailyActivityRow {
  day: string;
  runsCount: number;
  languagesUsed: string[];
  utilitiesUsed: number;
}

let schemaEnsured = false;
let retentionApplied = false;
let writeQueue: Promise<void> = Promise.resolve();

/** Test seam — resets the per-session ensure/retention latches. */
export function _resetRunLedgerForTests(): void {
  schemaEnsured = false;
  retentionApplied = false;
  writeQueue = Promise.resolve();
}

function ledgerEnabled(): boolean {
  return useSettingsStore.getState().runLedgerEnabled === true;
}

/** Single-quote escape for SQL text literals. Values are app-internal or
 * metadata-only, but escaping remains mandatory for defensively handling
 * future caller inputs. */
function sqlText(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'NULL';
  return String(value);
}

/** Epoch ms → TIMESTAMP literal (UTC, second precision is enough). */
function sqlTimestamp(epochMs: number): string {
  return `'${new Date(epochMs).toISOString().replace('T', ' ').slice(0, 19)}'`;
}

/** Epoch ms → the user's LOCAL calendar day as YYYY-MM-DD (streaks are a
 * human-local concept). Built by hand from the local date parts —
 * `toLocaleDateString` output is implementation and the DATE
 * primary key must never depend on a locale table. */
function localDay(epochMs: number): string {
  const date = new Date(epochMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const DDL_STATEMENTS = [
  'CREATE SCHEMA IF NOT EXISTS lingua_ledger',
  `CREATE TABLE IF NOT EXISTS lingua_ledger.runs (
    run_id UUID PRIMARY KEY,
    language TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok','error')),
    duration_ms INTEGER,
    started_at TIMESTAMP NOT NULL,
    code_sha256 TEXT,
    capsule_id UUID,
    tab_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS lingua_ledger.capsules (
    capsule_id UUID PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL,
    language TEXT,
    payload JSON NOT NULL,
    size_bytes INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lingua_ledger.daily_activity (
    day DATE PRIMARY KEY,
    runs_count INTEGER NOT NULL DEFAULT 0,
    languages_used JSON NOT NULL DEFAULT '[]',
    utilities_used INTEGER NOT NULL DEFAULT 0
  )`,
] as const;

async function runStatement(sql: string): Promise<boolean> {
  const outcome = await executeQuery(sql);
  return outcome.status === 'success';
}

async function ensureSchema(): Promise<boolean> {
  if (schemaEnsured) return true;
  for (const statement of DDL_STATEMENTS) {
    if (!(await runStatement(statement))) return false;
  }
  schemaEnsured = true;
  await applyRetentionOnce();
  return true;
}

/**
 * Free keeps FREE_RETENTION_DAYS of runs; orphaned capsules go with
 * them. Lazy, once per session, and only after the schema exists.
 */
async function applyRetentionOnce(): Promise<void> {
  if (retentionApplied) return;
  retentionApplied = true;
  if (isEntitled(currentEffectiveTier(), 'EXECUTION_HISTORY')) return;
  await runStatement(
    `DELETE FROM lingua_ledger.runs WHERE started_at < now() - INTERVAL ${FREE_RETENTION_DAYS} DAY`
  );
  await runStatement(
    `DELETE FROM lingua_ledger.capsules WHERE capsule_id NOT IN (
       SELECT capsule_id FROM lingua_ledger.runs WHERE capsule_id IS NOT NULL
     )`
  );
}

async function resolveContentHash(input: LedgerRunInput): Promise<string | null> {
  if (typeof input.contentHash === 'string' && SHA256_HEX_RE.test(input.contentHash)) {
    return input.contentHash;
  }
  if (typeof input.code === 'string' && input.code.length > 0) {
    try {
      return await computeContentHash(input.code);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Reduce a replay/export capsule to fields that are useful for correlating a
 * run but cannot carry the user's code, input, output, project identity, or
 * diagnostic text. `sanitizeRunCapsule` is intentionally insufficient here:
 * its contract preserves source and stdin for portable replay artifacts.
 */
function serializeLedgerCapsule(capsule: RunCapsuleV1): string {
  return JSON.stringify({
    version: capsule.version,
    capsuleId: capsule.capsuleId,
    createdAt: capsule.createdAt,
    appVersion: capsule.appVersion,
    language: capsule.tab.language,
    sourceHash: SHA256_HEX_RE.test(capsule.source.contentHash)
      ? capsule.source.contentHash
      : null,
    status: capsule.result.status,
    durationMs: capsule.result.durationMs,
    privacy: {
      redactionVersion: capsule.privacy.redactionVersion,
      omittedFields: [
        ...new Set([
          ...capsule.privacy.omittedFields,
          ...LEDGER_CAPSULE_OMITTED_FIELDS,
        ]),
      ],
    },
  });
}

async function writeRun(input: LedgerRunInput): Promise<void> {
  if (!ledgerEnabled()) return;
  if (!(await ensureSchema())) return;

  const runId = crypto.randomUUID();
  const codeSha = await resolveContentHash(input);
  let capsuleId: string | null = null;
  if (input.capsule) {
    capsuleId = input.capsule.capsuleId;
    const payload = serializeLedgerCapsule(input.capsule);
    // size_bytes means BYTES — encode instead of counting UTF-16 units.
    const payloadBytes = new TextEncoder().encode(payload).byteLength;
    const capsuleInsert = `INSERT OR IGNORE INTO lingua_ledger.capsules
      (capsule_id, schema_version, created_at, language, payload, size_bytes)
      VALUES (${sqlText(capsuleId)}, ${sqlNumber(input.capsule.version)},
              ${sqlText(input.capsule.createdAt.replace('T', ' ').slice(0, 19))},
              ${sqlText(input.capsule.tab.language)}, ${sqlText(payload)},
              ${sqlNumber(payloadBytes)})`;
    if (!(await runStatement(capsuleInsert))) {
      // One re-ensure + retry: the shared engine may have been restarted
      // (memory mode loses the schema) between ensure and this insert.
      schemaEnsured = false;
      if (!(await ensureSchema()) || !(await runStatement(capsuleInsert))) {
        capsuleId = null;
      }
    }
  }

  const runInsert = `INSERT INTO lingua_ledger.runs
    (run_id, language, status, duration_ms, started_at, code_sha256,
     capsule_id, tab_id)
    VALUES (${sqlText(runId)}, ${sqlText(input.language)}, ${sqlText(input.status)},
            ${sqlNumber(input.durationMs)}, ${sqlTimestamp(input.startedAtMs)},
            ${sqlText(codeSha)}, ${sqlText(capsuleId)},
            ${sqlText(input.tabId ?? null)})`;
  if (!(await runStatement(runInsert))) {
    schemaEnsured = false;
    if (!(await ensureSchema()) || !(await runStatement(runInsert))) return;
  }

  await bumpDailyActivity(input);
}

/** Read-modify-write of the per-day counters. Safe because every write
 * flows through the single queue — no interleaving within this session,
 * and the renderer is the database's only writer. */
async function bumpDailyActivity(input: LedgerRunInput): Promise<void> {
  const day = localDay(input.startedAtMs);
  const existing = await executeQuery(
    `SELECT runs_count, languages_used, utilities_used
     FROM lingua_ledger.daily_activity WHERE day = ${sqlText(day)}`
  );
  let runsCount = 0;
  let languages: string[] = [];
  let utilities = 0;
  if (existing.status === 'success' && existing.rows.length > 0) {
    const row = existing.rows[0]!;
    runsCount = Number(row['runs_count'] ?? 0);
    utilities = Number(row['utilities_used'] ?? 0);
    try {
      const parsed: unknown = JSON.parse(String(row['languages_used'] ?? '[]'));
      if (Array.isArray(parsed)) languages = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      languages = [];
    }
  }
  runsCount += 1;
  if (!languages.includes(input.language)) languages.push(input.language);
  if (input.language === 'pipeline') utilities += 1;

  await runStatement(
    `INSERT INTO lingua_ledger.daily_activity (day, runs_count, languages_used, utilities_used)
     VALUES (${sqlText(day)}, ${sqlNumber(runsCount)}, ${sqlText(JSON.stringify(languages))}, ${sqlNumber(utilities)})
     ON CONFLICT (day) DO UPDATE SET
       runs_count = excluded.runs_count,
       languages_used = excluded.languages_used,
       utilities_used = excluded.utilities_used`
  );
}

/**
 * Fire-and-forget entry point the run tap calls after a manual run
 * lands in the execution history. Never throws, never blocks the run
 * path; all writes serialize on one queue.
 */
export function recordRun(input: LedgerRunInput): void {
  if (!ledgerEnabled()) return;
  void scheduleLedgerTask(() => writeRun(input)).catch(() => {
    // Best-effort by contract — a ledger failure must never surface
    // into the run path.
  });
}

/** Await all queued writes — test/export seam. */
export function flushRunLedgerWrites(): Promise<void> {
  return writeQueue;
}

/**
 * Serialize writes, destructive actions, and exports in one FIFO. This makes
 * the Clear button a real boundary: writes queued before it are removed and
 * writes started afterwards land in the newly recreated schema. It also gives
 * Export one consistent snapshot without racing a background run write.
 */
function scheduleLedgerTask<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = writeQueue.then(task);
  writeQueue = scheduled.then(
    () => undefined,
    () => undefined
  );
  return scheduled;
}

// Read helpers deliberately do NOT ensure the schema: a read must never
// run DDL (Export/inspection with the ledger never used would otherwise
// CREATE the tables, contradicting the off-writes-nothing posture).
// Queries against a missing schema settle as errors and map to empties.

export async function queryRecentRuns(
  limit: number = RECENT_RUNS_DEFAULT_LIMIT
): Promise<LedgerRunRow[]> {
  const capped = Math.min(500, Math.max(1, Math.floor(limit)));
  const outcome = await executeQuery(
    `SELECT run_id, language, status, duration_ms, started_at, code_sha256,
            capsule_id, tab_id
     FROM lingua_ledger.runs ORDER BY started_at DESC LIMIT ${capped}`
  );
  if (outcome.status !== 'success') return [];
  return outcome.rows.map((row) => ({
    runId: String(row['run_id'] ?? ''),
    language: String(row['language'] ?? ''),
    status: String(row['status'] ?? ''),
    durationMs: row['duration_ms'] === null || row['duration_ms'] === undefined ? null : Number(row['duration_ms']),
    startedAt: String(row['started_at'] ?? ''),
    codeSha256: row['code_sha256'] === null || row['code_sha256'] === undefined ? null : String(row['code_sha256']),
    capsuleId: row['capsule_id'] === null || row['capsule_id'] === undefined ? null : String(row['capsule_id']),
    tabId: row['tab_id'] === null || row['tab_id'] === undefined ? null : String(row['tab_id']),
  }));
}

export async function getDailyActivity(days = 30): Promise<LedgerDailyActivityRow[]> {
  const capped = Math.min(3650, Math.max(1, Math.floor(days)));
  const outcome = await executeQuery(
    `SELECT day, runs_count, languages_used, utilities_used
     FROM lingua_ledger.daily_activity
     WHERE day >= current_date - INTERVAL ${capped} DAY
     ORDER BY day DESC`
  );
  if (outcome.status !== 'success') return [];
  return outcome.rows.map((row) => {
    let languages: string[] = [];
    try {
      const parsed: unknown = JSON.parse(String(row['languages_used'] ?? '[]'));
      if (Array.isArray(parsed)) languages = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      languages = [];
    }
    return {
      day: String(row['day'] ?? ''),
      runsCount: Number(row['runs_count'] ?? 0),
      languagesUsed: languages,
      utilitiesUsed: Number(row['utilities_used'] ?? 0),
    };
  });
}

/** Drop the whole ledger schema. The next enabled run recreates it. */
export async function clearLedger(): Promise<boolean> {
  try {
    return await scheduleLedgerTask(async () => {
      const dropped = await runStatement('DROP SCHEMA IF EXISTS lingua_ledger CASCADE');
      schemaEnsured = false;
      retentionApplied = false;
      return dropped;
    });
  } catch {
    schemaEnsured = false;
    retentionApplied = false;
    return false;
  }
}

/** The user's data, out: every table as JSON. Read-only — an export on a
 * never-used ledger yields empty arrays instead of creating the schema. */
export async function exportLedgerJson(): Promise<string> {
  return scheduleLedgerTask(async () => {
    const [runs, capsules, activity] = await Promise.all([
      executeQuery('SELECT * FROM lingua_ledger.runs ORDER BY started_at'),
      executeQuery('SELECT * FROM lingua_ledger.capsules ORDER BY created_at'),
      executeQuery('SELECT * FROM lingua_ledger.daily_activity ORDER BY day'),
    ]);
    return JSON.stringify(
      {
        runs: runs.status === 'success' ? runs.rows : [],
        capsules: capsules.status === 'success' ? capsules.rows : [],
        dailyActivity: activity.status === 'success' ? activity.rows : [],
      },
      null,
      2
    );
  });
}
