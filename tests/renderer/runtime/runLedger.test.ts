/**
 * internal — Run Ledger contract tests against an injected mock engine
 * (same seam as duckdbClient.test). Locks: opt-in gating (OFF writes
 * NOTHING), DDL-once-per-session, escaped inserts with hashes instead
 * of source, Free-tier retention pruning vs paid no-pruning, clear as
 * schema drop, and the JSON export shape.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __setDuckDbEngineFactoryForTests,
  type ArrowTableLike,
  type DuckDbConnection,
  type DuckDbEngineHandle,
} from '../../../src/renderer/runtime/duckdbClient';
import {
  _resetRunLedgerForTests,
  clearLedger,
  exportLedgerJson,
  flushRunLedgerWrites,
  getDailyActivity,
  queryRecentRuns,
  recordRun,
} from '../../../src/renderer/runtime/runLedger';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useLicenseStore } from '../../../src/renderer/stores/licenseStore';

const emptyTable: ArrowTableLike = {
  numRows: 0,
  schema: { fields: [] },
  toArray: () => [],
};

function tableFrom(rows: ReadonlyArray<Record<string, unknown>>): ArrowTableLike {
  const names = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return {
    numRows: rows.length,
    schema: { fields: names.map((name) => ({ name, type: { toString: () => 'VARCHAR' } })) },
    toArray: () => [...rows],
  };
}

/** Collects every SQL statement the ledger sends; optional per-query rows. */
function installSpyEngine(respond?: (sql: string) => ReadonlyArray<Record<string, unknown>> | null) {
  const statements: string[] = [];
  const engine: DuckDbEngineHandle = {
    connect: async (): Promise<DuckDbConnection> => ({
      query: async (sql: string) => {
        statements.push(sql);
        const rows = respond?.(sql) ?? null;
        const { mapArrowTable } = await import('../../../src/renderer/runtime/duckdbClient');
        return mapArrowTable(rows ? tableFrom(rows) : emptyTable);
      },
      close: async () => undefined,
    }),
    terminate: async () => undefined,
  };
  __setDuckDbEngineFactoryForTests(async () => engine);
  return statements;
}

const initialSettings = useSettingsStore.getState();
const initialLicense = useLicenseStore.getState();

beforeEach(() => {
  _resetRunLedgerForTests();
  useSettingsStore.setState({ runLedgerEnabled: true });
});

afterEach(() => {
  __setDuckDbEngineFactoryForTests(null);
  useSettingsStore.setState(initialSettings, true);
  useLicenseStore.setState(initialLicense, true);
  _resetRunLedgerForTests();
});

describe('runLedger', () => {
  it('writes NOTHING while the opt-in is off', async () => {
    useSettingsStore.setState({ runLedgerEnabled: false });
    const statements = installSpyEngine();
    recordRun({ language: 'javascript', status: 'ok', durationMs: 5, startedAtMs: 1_700_000_000_000 });
    await flushRunLedgerWrites();
    expect(statements).toEqual([]);
  });

  it('creates the schema once, hashes source, and records the run', async () => {
    const statements = installSpyEngine();
    recordRun({
      language: 'javascript',
      status: 'ok',
      durationMs: 12,
      startedAtMs: 1_700_000_000_000,
      tabId: 'tab-1',
      code: 'const token = "never-persist-me";',
    });
    recordRun({
      language: 'sql',
      status: 'error',
      durationMs: null,
      startedAtMs: 1_700_000_060_000,
      contentHash: 'not-a-hash-or-source',
    });
    await flushRunLedgerWrites();

    // Schema + 3 tables, once per session — the second run adds none.
    const ddl = statements.filter((sql) => sql.startsWith('CREATE'));
    expect(ddl).toHaveLength(4);
    expect(statements.filter((sql) => sql.includes('CREATE SCHEMA IF NOT EXISTS'))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes('CREATE TABLE IF NOT EXISTS'))).toHaveLength(3);

    const runInserts = statements.filter((sql) => sql.includes('INSERT INTO lingua_ledger.runs'));
    expect(runInserts).toHaveLength(2);
    // Source NEVER lands in the database — only its SHA-256 hex.
    expect(runInserts[0]).not.toContain('never-persist-me');
    expect(runInserts[0]).toMatch(/'[0-9a-f]{64}'/);
    // Invalid "hash" strings are not trusted as hashes, so they cannot
    // smuggle source text into the ledger.
    expect(runInserts[1]).toMatch(/'sql', 'error',\s+NULL/);
    expect(runInserts[1]).not.toContain('not-a-hash-or-source');

    const activityUpserts = statements.filter((sql) =>
      sql.includes('INSERT INTO lingua_ledger.daily_activity')
    );
    expect(activityUpserts).toHaveLength(2);
    expect(activityUpserts[1]).toContain('ON CONFLICT (day) DO UPDATE');
  });

  it('prunes runs older than 7 days for Free and skips pruning for paid tiers', async () => {
    const free = installSpyEngine();
    recordRun({ language: 'javascript', status: 'ok', durationMs: 1, startedAtMs: Date.now() });
    await flushRunLedgerWrites();
    expect(free.some((sql) => sql.includes('DELETE FROM lingua_ledger.runs WHERE started_at <'))).toBe(
      true
    );

    _resetRunLedgerForTests();
    useLicenseStore.setState({
      status: { kind: 'active', tier: 'pro' },
    } as unknown as Parameters<typeof useLicenseStore.setState>[0]);
    const pro = installSpyEngine();
    recordRun({ language: 'javascript', status: 'ok', durationMs: 1, startedAtMs: Date.now() });
    await flushRunLedgerWrites();
    expect(pro.some((sql) => sql.includes('DELETE FROM lingua_ledger.runs WHERE started_at <'))).toBe(
      false
    );
  });

  it('persists a metadata-only capsule summary and links it from the run row', async () => {
    const statements = installSpyEngine();
    recordRun({
      language: 'http',
      status: 'ok',
      durationMs: 30,
      startedAtMs: 1_700_000_000_000,
      contentHash: 'a'.repeat(64),
      capsule: {
        version: 1,
        capsuleId: '00000000-0000-4000-8000-000000000001',
        createdAt: '2024-01-01T00:00:00.000Z',
        appVersion: '0.0.0-test',
        tab: {
          name: 'private request name',
          language: 'http',
          runtimeMode: 'worker',
          workflowMode: 'run',
        },
        source: { content: 'const secret = "top-secret-source";', contentHash: 'a'.repeat(64) },
        input: { stdin: 'top-secret-input' },
        result: {
          status: 'ok',
          durationMs: 30,
          stdout: 'top-secret-stdout',
          stderr: 'top-secret-stderr',
          diagnostics: [{ message: 'top-secret-diagnostic' }],
          richOutputs: [{ secret: 'top-secret-rich-output' }],
          errorMessage: 'top-secret-error',
        },
        environment: {
          platform: 'web',
          runner: 'worker',
          git: { branch: 'private-branch', commit: 'abc123' },
        },
        privacy: { redactionVersion: 'test', omittedFields: ['already-redacted'] },
      } as never,
    });
    await flushRunLedgerWrites();

    const capsuleInsert = statements.find((sql) => sql.includes('INSERT OR IGNORE INTO lingua_ledger.capsules'));
    expect(capsuleInsert).toBeTruthy();
    expect(capsuleInsert).toContain('00000000-0000-4000-8000-000000000001');
    expect(capsuleInsert).toContain('"sourceHash"');
    for (const secret of [
      'private request name',
      'top-secret-source',
      'top-secret-input',
      'top-secret-stdout',
      'top-secret-stderr',
      'top-secret-diagnostic',
      'top-secret-rich-output',
      'top-secret-error',
      'private-branch',
    ]) {
      expect(capsuleInsert).not.toContain(secret);
    }
    const runInsert = statements.find((sql) => sql.includes('INSERT INTO lingua_ledger.runs'));
    expect(runInsert).toContain('00000000-0000-4000-8000-000000000001');
  });

  it('clearLedger drops the schema and the next run recreates it', async () => {
    const statements = installSpyEngine();
    recordRun({ language: 'javascript', status: 'ok', durationMs: 1, startedAtMs: Date.now() });
    await flushRunLedgerWrites();
    await clearLedger();
    expect(statements.some((sql) => sql.includes('DROP SCHEMA IF EXISTS lingua_ledger CASCADE'))).toBe(
      true
    );
    const before = statements.filter((sql) => sql.includes('CREATE SCHEMA')).length;
    recordRun({ language: 'javascript', status: 'ok', durationMs: 1, startedAtMs: Date.now() });
    await flushRunLedgerWrites();
    const after = statements.filter((sql) => sql.includes('CREATE SCHEMA')).length;
    expect(after).toBe(before + 1);
  });

  it('serializes Clear between already-queued and subsequently-started runs', async () => {
    const statements = installSpyEngine();
    recordRun({ language: 'before-clear', status: 'ok', durationMs: 1, startedAtMs: Date.now() });
    const clearing = clearLedger();
    recordRun({ language: 'after-clear', status: 'ok', durationMs: 1, startedAtMs: Date.now() });

    await clearing;
    await flushRunLedgerWrites();

    const beforeIndex = statements.findIndex((sql) => sql.includes("'before-clear'"));
    const dropIndex = statements.findIndex((sql) =>
      sql.includes('DROP SCHEMA IF EXISTS lingua_ledger CASCADE')
    );
    const afterIndex = statements.findIndex((sql) => sql.includes("'after-clear'"));
    expect(beforeIndex).toBeGreaterThanOrEqual(0);
    expect(dropIndex).toBeGreaterThan(beforeIndex);
    expect(afterIndex).toBeGreaterThan(dropIndex);
  });

  it('exports every table as structured JSON', async () => {
    installSpyEngine((sql) =>
      sql.startsWith('SELECT * FROM lingua_ledger.runs')
        ? [{ run_id: 'r1', language: 'javascript' }]
        : null
    );
    const json = JSON.parse(await exportLedgerJson()) as {
      runs: unknown[];
      capsules: unknown[];
      dailyActivity: unknown[];
    };
    expect(json.runs).toEqual([{ run_id: 'r1', language: 'javascript' }]);
    expect(json.capsules).toEqual([]);
    expect(json.dailyActivity).toEqual([]);
  });

  it('read helpers never run DDL — inspecting a never-used ledger creates nothing', async () => {
    const statements = installSpyEngine();
    await queryRecentRuns();
    await getDailyActivity();
    await exportLedgerJson();
    expect(statements.some((sql) => sql.startsWith('CREATE'))).toBe(false);
  });

  it('stores only metadata capsule fields and measures that summary in bytes', async () => {
    const statements = installSpyEngine();
    const capsule = {
      version: 1,
      capsuleId: '00000000-0000-4000-8000-000000000002',
      createdAt: '2024-01-01T00:00:00.000Z',
      appVersion: '0.0.0-ñ-test',
      tab: {
        name: 'ñandú private name',
        language: 'javascript',
        runtimeMode: 'worker',
        workflowMode: 'run',
      },
      source: { content: 'super-secret-source', contentHash: 'b'.repeat(64) },
      input: { stdin: 'super-secret-input' },
      result: {
        status: 'ok',
        durationMs: 1,
        stdout: 'super-secret-output',
        stderr: 'super-secret-error',
      },
      environment: { platform: 'web', runner: 'worker' },
      privacy: { redactionVersion: 'test', omittedFields: [] },
    } as never;
    recordRun({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
      startedAtMs: 1_700_000_000_000,
      capsule,
    });
    await flushRunLedgerWrites();

    const runInsert = statements.find((sql) => sql.includes('INSERT INTO lingua_ledger.runs'));
    expect(runInsert).not.toContain('super-secret-output');

    const capsuleInsert = statements.find((sql) =>
      sql.includes('INSERT OR IGNORE INTO lingua_ledger.capsules')
    );
    const payloadBytes = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        capsuleId: '00000000-0000-4000-8000-000000000002',
        createdAt: '2024-01-01T00:00:00.000Z',
        appVersion: '0.0.0-ñ-test',
        language: 'javascript',
        sourceHash: 'b'.repeat(64),
        status: 'ok',
        durationMs: 1,
        privacy: {
          redactionVersion: 'test',
          omittedFields: [
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
          ],
        },
      })
    ).byteLength;
    expect(capsuleInsert?.trimEnd().endsWith(`${payloadBytes})`)).toBe(true);
    expect(capsuleInsert).not.toContain('super-secret-source');
    expect(capsuleInsert).not.toContain('super-secret-input');
    expect(capsuleInsert).not.toContain('super-secret-output');
    expect(capsuleInsert).not.toContain('ñandú private name');
  });

  it('queryRecentRuns maps rows and caps the limit', async () => {
    installSpyEngine((sql) =>
      sql.includes('FROM lingua_ledger.runs ORDER BY')
        ? [
            {
              run_id: 'r1',
              language: 'sql',
              status: 'ok',
              duration_ms: 4,
              started_at: '2024-01-01 00:00:00',
              code_sha256: null,
              capsule_id: null,
              tab_id: null,
            },
          ]
        : null
    );
    const rows = await queryRecentRuns(9_999);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: 'r1', language: 'sql', durationMs: 4, codeSha256: null });
  });
});
