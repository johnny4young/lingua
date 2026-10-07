/**
 * SQL workspace — identifier-quoting helper tests.
 *
 * Guards the schema-browser table-insert path: the `SELECT * FROM
 * <table>` starter must quote the identifier so names with spaces,
 * reserved words, mixed case, or injected quotes round-trip into a
 * valid single statement instead of broken — or statement-chaining —
 * SQL.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSelectStarter,
  quoteSqlIdentifier,
  quoteSqlTableReference,
} from '../../../src/renderer/components/SqlWorkspace/sqlResultFormatters';

describe('quoteSqlIdentifier', () => {
  it('wraps a plain identifier in double quotes', () => {
    expect(quoteSqlIdentifier('users')).toBe('"users"');
  });

  it('quotes names with spaces so they stay a single identifier', () => {
    expect(quoteSqlIdentifier('my table')).toBe('"my table"');
  });

  it('preserves mixed case (DuckDB folds unquoted identifiers to lowercase)', () => {
    expect(quoteSqlIdentifier('UserProfiles')).toBe('"UserProfiles"');
  });

  it('doubles embedded double quotes so injection cannot break out', () => {
    expect(quoteSqlIdentifier('a"; DROP TABLE users; --')).toBe(
      '"a""; DROP TABLE users; --"'
    );
  });
});

describe('buildSelectStarter', () => {
  it('builds a quoted single-statement starter', () => {
    expect(buildSelectStarter('users')).toBe(
      'SELECT * FROM "users" LIMIT 100;'
    );
  });

  it('keeps a reserved-word table name valid by quoting it', () => {
    expect(buildSelectStarter('select')).toBe(
      'SELECT * FROM "select" LIMIT 100;'
    );
  });

  it('neutralizes a malicious table name into one quoted identifier', () => {
    const starter = buildSelectStarter('x"; DELETE FROM secrets; --');
    // The injected closing quote is doubled, so the whole payload stays
    // inside the identifier — there is no second statement.
    expect(starter).toBe(
      'SELECT * FROM "x""; DELETE FROM secrets; --" LIMIT 100;'
    );
  });

  it('quotes schema and table separately for a non-main table', () => {
    expect(quoteSqlTableReference('runs', 'lingua_ledger')).toBe(
      '"lingua_ledger"."runs"'
    );
    expect(buildSelectStarter('runs', 'lingua_ledger')).toBe(
      'SELECT * FROM "lingua_ledger"."runs" LIMIT 100;'
    );
  });

  it('keeps a dot in either raw identifier from changing SQL structure', () => {
    expect(buildSelectStarter('runs.data', 'ledger space')).toBe(
      'SELECT * FROM "ledger space"."runs.data" LIMIT 100;'
    );
  });
});
