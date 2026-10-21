import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSqlStorageModeTelemetryForTests,
  sqlConnectionTestedPayload,
  trackSqlProfileOpened,
  trackSqlQueryExecuted,
  trackSqlStorageMode,
  trackSqlTableImported,
} from '../../../src/renderer/hooks/sqlWorkspaceTelemetry';
import { trackEvent } from '../../../src/renderer/utils/telemetry';

vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

const trackEventMock = trackEvent as unknown as ReturnType<typeof vi.fn>;

describe('sqlWorkspaceTelemetry', () => {
  beforeEach(() => {
    __resetSqlStorageModeTelemetryForTests();
    trackEventMock.mockClear();
  });

  it('dedupes repeated storage-mode telemetry for the same resolved/requested pair', () => {
    trackSqlStorageMode('memory', 'memory');
    trackSqlStorageMode('memory', 'memory');
    trackSqlStorageMode('memory', 'opfs');

    expect(trackEventMock).toHaveBeenCalledTimes(2);
    expect(trackEventMock).toHaveBeenNthCalledWith(1, 'sql.storage_mode', {
      mode: 'memory',
      requested: 'memory',
    });
    expect(trackEventMock).toHaveBeenNthCalledWith(2, 'sql.storage_mode', {
      mode: 'memory',
      requested: 'opfs',
    });
  });

  it('emits sql.table_imported with the closed-enum format + source only', () => {
    trackSqlTableImported('csv', 'picker');
    trackSqlTableImported('parquet', 'drop');

    expect(trackEventMock).toHaveBeenNthCalledWith(1, 'sql.table_imported', {
      format: 'csv',
      source: 'picker',
    });
    expect(trackEventMock).toHaveBeenNthCalledWith(2, 'sql.table_imported', {
      format: 'parquet',
      source: 'drop',
    });
  });

  it('emits sql.profile_opened without query or result properties', () => {
    trackSqlProfileOpened();

    expect(trackEventMock).toHaveBeenCalledWith('sql.profile_opened', {});
  });

  it('tags each query with its engine, Local when the response names none', () => {
    const base = { version: 1, status: 'success', rows: [], columns: [], rowCount: 3, durationMs: 40, tooLarge: false, statementCount: 1, recordedAt: '' } as const;
    trackSqlQueryExecuted(base);
    trackSqlQueryExecuted({ ...base, engine: 'mysql' });
    expect(trackEventMock).toHaveBeenNthCalledWith(1, 'sql.query_executed', { status: 'success', rowCountBucket: '2-5', durationBucket: '<100ms', engine: 'duckdb' });
    expect(trackEventMock.mock.calls[1]?.[1]).toMatchObject({ engine: 'mysql' });
  });

  it('reports a connection test by engine, first failed step and duration only', () => {
    const payload = sqlConnectionTestedPayload('postgres', {
      ok: false,
      totalMs: 1_200,
      steps: [
        { id: 'resolve', status: 'ok', ms: 1, detail: 'db.internal → 10.0.4.12' },
        { id: 'tcp', status: 'failed', ms: 1_000, detail: '10.0.4.12:5432 refused', fix: 'unreachable' },
      ],
    });
    expect(payload).toEqual({ engine: 'postgres', failedStep: 'tcp', durationBucket: '<5s' });
    expect(sqlConnectionTestedPayload('sqlite', { ok: true, totalMs: 4, steps: [{ id: 'file', status: 'ok' }] }).failedStep).toBe('none');
  });
});
