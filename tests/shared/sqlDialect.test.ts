import { describe, expect, it } from 'vitest';
import { sqlDialect } from '../../src/shared/sqlDialect';
import { quoteSqlIdentifier, quoteSqlTableReference } from '../../src/shared/sqlQuote';

describe('sqlDialect', () => {
  it('defaults to Local DuckDB', () => {
    expect(sqlDialect(undefined)).toBe(sqlDialect('duckdb'));
    expect(sqlDialect(undefined).formatter).toBe('duckdb');
  });

  it('maps each engine to its formatter language and prompt name', () => {
    expect(['duckdb', 'postgres', 'mysql', 'sqlite', 'sqlserver', 'clickhouse'].map((engine) => [sqlDialect(engine as never).formatter, sqlDialect(engine as never).label])).toEqual([
      ['duckdb', 'DuckDB'],
      ['postgresql', 'PostgreSQL'],
      ['mysql', 'MySQL'],
      ['sqlite', 'SQLite'],
      ['transactsql', 'SQL Server'],
      ['clickhouse', 'ClickHouse'],
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

  it('quotes SQL Server names in brackets and writes Unicode literals', () => {
    expect(quoteSqlTableReference('we]ird', 'dbo', 'sqlserver')).toBe('[dbo].[we]]ird]');
    expect(sqlDialect('sqlserver').stringLiteral("it's C:\\temp")).toBe("N'it''s C:\\temp'");
  });

  it('escapes ClickHouse names and strings with backslashes, since ClickHouse reads them as escapes', () => {
    expect(quoteSqlIdentifier('a`b\\c', 'clickhouse')).toBe('`a\\`b\\\\c`');
    expect(sqlDialect('clickhouse').stringLiteral("it's C:\\temp")).toBe("'it\\'s C:\\\\temp'");
  });

  it('keeps SQL Server wildcards and brackets literal in contains, and lets ClickHouse search without LIKE', () => {
    expect(sqlDialect('sqlserver').contains('[city]', "5[0]%_o'f")).toBe("LOWER(CAST([city] AS NVARCHAR(MAX))) LIKE LOWER(N'%5\\[0]\\%\\_o''f%') ESCAPE '\\'");
    expect(sqlDialect('clickhouse').contains('`city`', "o'f")).toBe("positionCaseInsensitiveUTF8(toString(`city`), 'o\\'f') > 0");
  });

  it('writes the first rows with TOP on SQL Server and LIMIT elsewhere', () => {
    expect(sqlDialect('sqlserver').firstRows('[dbo].[orders]', 100)).toBe('SELECT TOP (100) * FROM [dbo].[orders];');
    expect(sqlDialect('clickhouse').firstRows('`orders`', 100)).toBe('SELECT * FROM `orders` LIMIT 100;');
  });
});
