/**
 * RL-097 Slice 2 — sqlResponseCapsule tests.
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
