import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setDuckDbEngineFactoryForTests,
  type DuckDbConnection,
  type DuckDbEngineHandle,
} from '../../../src/renderer/runtime/duckdbClient';
import {
  buildColumnProfileQuery,
  profileSqlQuery,
} from '../../../src/renderer/runtime/sqlColumnProfile';
import { MAX_QUERY_BYTES } from '../../../src/shared/sqlWorkspace';

function profileEngine(
  query: (sql: string) => Promise<Awaited<ReturnType<DuckDbConnection['query']>>>
): DuckDbEngineHandle {
  return {
    connect: async (): Promise<DuckDbConnection> => ({
      query,
      close: async () => undefined,
    }),
    terminate: async () => undefined,
  };
}

afterEach(() => {
  __setDuckDbEngineFactoryForTests(null);
});

/** Mirrors the SUMMARIZE wrapper: stable projection + null_percentage cast. */
function summarizeWrapper(query: string): string {
  return `SELECT column_name, column_type, min, max, approx_unique, avg, std, CAST(null_percentage AS DOUBLE) AS null_percentage FROM (SUMMARIZE ${query})`;
}

describe('buildColumnProfileQuery', () => {
  it('wraps a single SELECT with DuckDB SUMMARIZE and drops only a trailing terminator', () => {
    expect(buildColumnProfileQuery(' SELECT id, name FROM people;  ')).toBe(
      summarizeWrapper('SELECT id, name FROM people')
    );
  });

  it('supports a single CTE query', () => {
    expect(buildColumnProfileQuery('WITH rows AS (SELECT 1 AS id) SELECT * FROM rows')).toBe(
      summarizeWrapper('WITH rows AS (SELECT 1 AS id) SELECT * FROM rows')
    );
  });

  it('refuses empty, mutating, and multi-statement input', () => {
    expect(buildColumnProfileQuery('')).toBeNull();
    expect(buildColumnProfileQuery('DELETE FROM people')).toBeNull();
    expect(
      buildColumnProfileQuery(
        'WITH candidates AS (SELECT id FROM people) DELETE FROM people USING candidates'
      )
    ).toBeNull();
    expect(
      buildColumnProfileQuery(
        'WITH candidates AS (SELECT id FROM people) MERGE INTO people USING candidates ON true WHEN MATCHED THEN DELETE'
      )
    ).toBeNull();
    expect(buildColumnProfileQuery('SELECT 1; SELECT 2')).toBeNull();
  });

  it('does not mistake a semicolon in a string literal for multiple statements', () => {
    expect(buildColumnProfileQuery("SELECT ';' AS separator;")).toBe(
      summarizeWrapper("SELECT ';' AS separator")
    );
  });

  it('ignores mutation words inside literals, quoted identifiers, and comments', () => {
    expect(buildColumnProfileQuery("SELECT 'delete' AS action")).toBe(
      summarizeWrapper("SELECT 'delete' AS action")
    );
    expect(buildColumnProfileQuery('SELECT "update" FROM metrics -- delete')).toBe(
      summarizeWrapper('SELECT "update" FROM metrics -- delete')
    );
  });

  it('keeps the scalar replace() function profileable while refusing mutating REPLACE forms', () => {
    // DuckDB has no standalone REPLACE statement: its mutating spellings
    // (CREATE OR REPLACE, INSERT OR REPLACE INTO) always carry a keyword the
    // guard already blocks, so a bare replace() must not hide the action.
    expect(buildColumnProfileQuery("SELECT replace(name, 'a', 'b') FROM people")).toBe(
      summarizeWrapper("SELECT replace(name, 'a', 'b') FROM people")
    );
    expect(buildColumnProfileQuery('SELECT * REPLACE (id + 1 AS id) FROM people')).toBe(
      summarizeWrapper('SELECT * REPLACE (id + 1 AS id) FROM people')
    );
    expect(
      buildColumnProfileQuery(
        'WITH rows AS (SELECT 1) INSERT OR REPLACE INTO people SELECT * FROM rows'
      )
    ).toBeNull();
  });

  it('refuses a profile wrapper that would exceed the workspace query cap', () => {
    const source = `SELECT '${'x'.repeat(MAX_QUERY_BYTES)}' AS value`;
    expect(buildColumnProfileQuery(source)).toBeNull();
  });
});

describe('profileSqlQuery', () => {
  it('runs the correct DuckDB query and maps summary rows for presentation', async () => {
    const observedQueries: string[] = [];
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        profileEngine(async (sql) => {
          observedQueries.push(sql);
          return {
            columns: [],
            rows: [
              {
                column_name: 'score',
                column_type: 'INTEGER',
                min: 1,
                max: 9,
                approx_unique: 3,
                avg: 5,
                std: 2.5,
                null_percentage: 25,
              },
            ],
            rowCount: 1,
            tooLarge: false,
          };
        })
      )
    );

    await expect(profileSqlQuery('SELECT score FROM metrics')).resolves.toEqual({
      status: 'success',
      tooLarge: false,
      profiles: [
        {
          columnName: 'score',
          columnType: 'INTEGER',
          min: '1',
          max: '9',
          approximateUnique: '3',
          average: '5',
          standardDeviation: '2.5',
          nullPercentage: '25',
        },
      ],
    });
    expect(observedQueries).toEqual([summarizeWrapper('SELECT score FROM metrics')]);
  });

  it('returns a typed non-profileable outcome without loading DuckDB', async () => {
    const engineFactory = vi.fn();
    __setDuckDbEngineFactoryForTests(engineFactory);

    await expect(profileSqlQuery('CREATE TABLE metrics AS SELECT 1')).resolves.toEqual({
      status: 'not-profileable',
    });
    expect(engineFactory).not.toHaveBeenCalled();
  });

  it('surfaces a secondary SQL error without throwing', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        profileEngine(async () => {
          throw new Error('profile failed');
        })
      )
    );

    await expect(profileSqlQuery('SELECT score FROM metrics')).resolves.toMatchObject({
      status: 'sql-error',
      errorMessage: 'profile failed',
    });
  });
});
