import { describe, expect, it } from 'vitest';
import { sqlDialect } from '../../src/shared/sqlDialect';
import { quoteSqlIdentifier, quoteSqlTableReference } from '../../src/shared/sqlQuote';

describe('sqlDialect', () => {
  it('defaults to Local DuckDB', () => {
    expect(sqlDialect(undefined)).toBe(sqlDialect('duckdb'));
    expect(sqlDialect(undefined).formatter).toBe('duckdb');
  });

  it('maps each engine to its formatter language and prompt name', () => {
    expect(['duckdb', 'postgres', 'mysql', 'sqlite'].map((engine) => [sqlDialect(engine as never).formatter, sqlDialect(engine as never).label])).toEqual([
      ['duckdb', 'DuckDB'],
      ['postgresql', 'PostgreSQL'],
      ['mysql', 'MySQL'],
      ['sqlite', 'SQLite'],
    ]);
  });

  it('quotes identifiers in the engine style, doubling the quote inside', () => {
    expect(quoteSqlIdentifier('order "items"')).toBe('"order ""items"""');
    expect(quoteSqlIdentifier('order `items`', 'mysql')).toBe('`order ``items```');
    expect(quoteSqlTableReference('orders', 'billing', 'mysql')).toBe('`billing`.`orders`');
    expect(quoteSqlTableReference('orders', 'public', 'postgres')).toBe('"public"."orders"');
  });

  it('writes string literals MySQL reads back as written, backslashes included', () => {
    expect(sqlDialect('mysql').stringLiteral("it's C:\\temp")).toBe("'it''s C:\\\\temp'");
    expect(sqlDialect('postgres').stringLiteral("it's C:\\temp")).toBe("'it''s C:\\temp'");
  });

  it('builds a case-insensitive contains predicate each engine accepts', () => {
    expect(sqlDialect('duckdb').contains('"city"', '50%_off')).toBe(`CAST("city" AS VARCHAR) ILIKE '%50\\%\\_off%' ESCAPE '\\'`);
    expect(sqlDialect('postgres').contains('"city"', 'bog')).toBe(`CAST("city" AS TEXT) ILIKE '%bog%' ESCAPE '\\'`);
    // MySQL has no ILIKE, and a backslash ESCAPE would need escaping inside its strings.
    expect(sqlDialect('mysql').contains('`city`', "50%_o'f!f")).toBe("CAST(`city` AS CHAR) LIKE '%50!%!_o''f!!f%' ESCAPE '!'");
    expect(sqlDialect('sqlite').contains('"city"', 'bog')).toBe(`CAST("city" AS TEXT) LIKE '%bog%' ESCAPE '\\'`);
  });
});
