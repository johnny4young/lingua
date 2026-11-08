/**
 * sqlResponseCapsule tests.
 *
 * Mirrors the httpResponseCapsule shape tests: status mapping per
 * SQL status + language/runner pin + stdout/stderr routing.
 */

import { describe, expect, it } from 'vitest';
import { buildSqlResponseCapsule } from '../../../src/renderer/runtime/sqlResponseCapsule';
import type { SqlQueryV1, SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

function fixtureQuery(overrides: Partial<SqlQueryV1> = {}): SqlQueryV1 {
  return {
    version: 1,
    id: '00000000-0000-4000-8000-000000000001',
    name: 'select-one',
    query: 'SELECT 1;',
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

function fixtureResponse(overrides: Partial<SqlResponseV1> = {}): SqlResponseV1 {
  return {
    version: 1,
    status: 'success',
    rows: [{ a: 1 }],
    columns: [{ name: 'a', type: 'INTEGER' }],
    rowCount: 1,
    durationMs: 5,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildSqlResponseCapsule', () => {
  it('leaves a connection out: its rows, its driver message and the secrets in its SQL', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: '1.0.0',
      query: fixtureQuery({ query: "ALTER USER app PASSWORD 'hunter2'" }),
      response: fixtureResponse({ engine: 'mysql', status: 'sql-error', errorMessage: "near 'PASSWORD hunter2'" }),
      platform: 'desktop',
    });
    expect(JSON.stringify(capsule)).not.toContain('hunter2');
    expect(capsule.result.stdout).toBeUndefined();
    expect(capsule.result.stderr).toBe('The mysql connection returned an error.');
  });

  it('treats a result tagged duckdb as Local', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: '1.0.0',
      query: fixtureQuery(),
      response: fixtureResponse({ engine: 'duckdb' }),
      platform: 'web',
    });
    expect(capsule.result.stdout).toContain('"a": 1');
  });

  it('keeps Local rows and errors, and masks the secrets in its SQL too', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: '1.0.0',
      query: fixtureQuery({ query: "CREATE SECRET s (TYPE s3, KEY_ID 'hunter2')" }),
      response: fixtureResponse({ errorMessage: 'Parser Error' }),
      platform: 'web',
    });
    expect(capsule.source.content).not.toContain('hunter2');
    expect(capsule.result.stdout).toContain('"a": 1');
    expect(capsule.result.stderr).toBe('Parser Error');
  });

  it('pins tab.language=sql + runner=duckdb-wasm', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: 'test',
      platform: 'web',
      query: fixtureQuery(),
      response: fixtureResponse(),
    });
    expect(capsule.tab.language).toBe('sql');
    expect(capsule.tab.runtimeMode).toBe('duckdb-wasm');
    expect(capsule.environment.runner).toBe('duckdb-wasm');
  });

  it('records non-finite values as text and NULL as null in the row preview', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: 'test',
      platform: 'web',
      query: fixtureQuery(),
      response: fixtureResponse({
        rows: [{ a: 'Infinity' }, { a: 'NaN' }, { a: null }],
        columns: [{ name: 'a', type: 'Float64' }],
        rowCount: 3,
      }),
    });
    expect(JSON.parse(capsule.result.stdout ?? '')).toEqual([{ a: 'Infinity' }, { a: 'NaN' }, { a: null }]);
  });

  it('names the engine of a saved connection and nothing about where it points', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: 'test',
      platform: 'desktop',
      query: fixtureQuery({ connectionId: 'c_0123456789abcdef' }),
      response: fixtureResponse({ engine: 'postgres' }),
    });
    expect(capsule.tab.runtimeMode).toBe('sql-postgres');
    expect(capsule.environment.runner).toBe('sql-postgres');
    expect(JSON.stringify(capsule)).not.toContain('c_0123456789abcdef');
  });

  it('keeps the server message of a connection failure out of the capsule', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: 'test',
      platform: 'desktop',
      query: fixtureQuery(),
      response: fixtureResponse({
        status: 'connection-failed',
        engine: 'mysql',
        rows: [],
        rowCount: 0,
        errorMessage: "Access denied for user 'root'@'10.0.4.12' (using password: YES)",
      }),
    });
    expect(capsule.result.status).toBe('error');
    expect(capsule.result.stderr).toBe('Could not connect to the mysql connection.');
    expect(JSON.stringify(capsule)).not.toMatch(/root|10\.0\.4\.12/);
  });

  it('maps success status to success', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: 'test',
      platform: 'web',
      query: fixtureQuery(),
      response: fixtureResponse({ status: 'success' }),
    });
    expect(capsule.result.status).toBe('success');
  });

  it('maps timeout to timeout', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: 'test',
      platform: 'web',
      query: fixtureQuery(),
      response: fixtureResponse({ status: 'timeout', errorMessage: 'tle' }),
    });
    expect(capsule.result.status).toBe('timeout');
    expect(capsule.result.stderr).toBe('tle');
  });

  it('maps sql-error / too-large / engine-load-failed to error', async () => {
    const variants: Array<SqlResponseV1['status']> = [
      'sql-error',
      'too-large',
      'engine-load-failed',
    ];
    for (const status of variants) {
      const capsule = await buildSqlResponseCapsule({
        appVersion: 'test',
        platform: 'web',
        query: fixtureQuery(),
        response: fixtureResponse({ status }),
      });
      expect(capsule.result.status, `status=${status}`).toBe('error');
    }
  });

  it('routes the rows preview into result.stdout', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: 'test',
      platform: 'web',
      query: fixtureQuery(),
      response: fixtureResponse({ rows: [{ a: 1 }, { a: 2 }] }),
    });
    expect(capsule.result.stdout).toContain('"a": 1');
    expect(capsule.result.stdout).toContain('"a": 2');
  });

  it('source.content carries the query text verbatim', async () => {
    const capsule = await buildSqlResponseCapsule({
      appVersion: 'test',
      platform: 'web',
      query: fixtureQuery({ query: 'SELECT 42 AS answer;' }),
      response: fixtureResponse(),
    });
    expect(capsule.source.content).toBe('SELECT 42 AS answer;');
  });
});
