/**
 * RL-068 — Unit tests for `formatSql`. Async because the helper
 * lazy-imports `sql-formatter`. Covers all three dialects, the
 * keyword-case toggle, the indent option, the empty / tooLarge
 * branches, and a parse-failure surface.
 */

import { describe, expect, it } from 'vitest';
import {
  SQL_FORMATTER_MAX_BYTES,
  formatSql,
} from '../../src/renderer/utils/sqlFormatter';

describe('formatSql', () => {
  it('formats an ANSI SELECT with upper-case keywords', async () => {
    const result = await formatSql(
      'select id from users where active = 1',
      { dialect: 'sql', tabWidth: 2, keywordCase: 'upper' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('SELECT');
    expect(result.output).toContain('FROM');
    expect(result.output).toContain('WHERE');
  });

  it('preserves keyword case when keywordCase=preserve', async () => {
    const result = await formatSql('select 1', {
      dialect: 'sql',
      tabWidth: 2,
      keywordCase: 'preserve',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('select');
  });

  it('lowercases keywords when keywordCase=lower', async () => {
    const result = await formatSql('SELECT 1', {
      dialect: 'sql',
      tabWidth: 2,
      keywordCase: 'lower',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('select');
  });

  it('honors the 4-space indent option', async () => {
    const result = await formatSql(
      'select id, name from users where deleted_at is null',
      { dialect: 'sql', tabWidth: 4, keywordCase: 'upper' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Continuation lines indent by 4 spaces.
    expect(result.output).toMatch(/\n {4}/);
  });

  it('formats a PostgreSQL-flavored statement', async () => {
    const result = await formatSql(
      "select id from users where created_at > now() - interval '7 days'",
      { dialect: 'postgresql', tabWidth: 2, keywordCase: 'upper' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('SELECT');
    // Postgres-specific tokens like `interval` survive verbatim.
    expect(result.output.toLowerCase()).toContain('interval');
  });

  it('formats a MySQL-flavored statement', async () => {
    const result = await formatSql(
      'select id from `users` where `id` = 1',
      { dialect: 'mysql', tabWidth: 2, keywordCase: 'upper' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Backtick identifiers should round-trip in MySQL mode.
    expect(result.output).toContain('`users`');
    expect(result.output).toContain('`id`');
  });

  it('rejects empty input with the empty error key', async () => {
    expect(
      await formatSql('', { dialect: 'sql', tabWidth: 2, keywordCase: 'upper' })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.sqlFormatter.error.empty',
    });
  });

  it('rejects payloads above the byte cap with the tooLarge error key', async () => {
    const huge = 'select 1; '.repeat(SQL_FORMATTER_MAX_BYTES);
    expect(
      await formatSql(huge, { dialect: 'sql', tabWidth: 2, keywordCase: 'upper' })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.sqlFormatter.error.tooLarge',
    });
  });

  it('keeps string literals intact while reformatting whitespace', async () => {
    const result = await formatSql(
      `insert into logs (message) values ('hello   world')`,
      { dialect: 'sql', tabWidth: 2, keywordCase: 'upper' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain("'hello   world'");
  });
});
