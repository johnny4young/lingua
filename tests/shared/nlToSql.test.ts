/**
 * implementation follow-on — NL→SQL request builder. Pins the schema-only payload
 * contract: table/column names + types go to the model, never rows.
 */

import { describe, expect, it } from 'vitest';
import {
  buildNlToSqlRequest,
  formatSchemaForPrompt,
  MAX_NLSQL_QUESTION_CHARS,
  MAX_NLSQL_SCHEMA_CHARS,
} from '../../src/shared/ai/nlToSql';

describe('formatSchemaForPrompt', () => {
  it('renders one name(col TYPE, …) line per table', () => {
    const text = formatSchemaForPrompt([
      {
        name: 'orders',
        columns: [
          { name: 'id', type: 'BIGINT' },
          { name: 'total', type: 'DOUBLE' },
        ],
      },
      { name: 'bare_table' },
    ]);
    expect(text).toBe('orders(id BIGINT, total DOUBLE)\nbare_table');
  });

  it('says so when the session has no tables', () => {
    expect(formatSchemaForPrompt([])).toContain('no tables');
  });
});

describe('buildNlToSqlRequest', () => {
  it('builds a DuckDB system prompt + schema/question user content', () => {
    const req = buildNlToSqlRequest({
      question: 'top 5 orders by total',
      schemaText: 'orders(id BIGINT, total DOUBLE)',
    });
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]!.role).toBe('system');
    expect(req.messages[0]!.content).toContain('DuckDB');
    expect(req.messages[1]!.content).toContain(
      'orders(id BIGINT, total DOUBLE)'
    );
    expect(req.messages[1]!.content).toContain('top 5 orders by total');
  });

  it('exposes a consent preview mirroring the payload', () => {
    const req = buildNlToSqlRequest({
      question: 'count rows',
      schemaText: 't(a INT)',
    });
    expect(req.preview).toContain('will be sent to your configured AI endpoint');
    expect(req.preview).toContain('t(a INT)');
  });

  it('bounds a huge question and a huge schema', () => {
    const req = buildNlToSqlRequest({
      question: 'q'.repeat(MAX_NLSQL_QUESTION_CHARS + 500),
      schemaText: 's'.repeat(MAX_NLSQL_SCHEMA_CHARS + 500),
    });
    expect(req.messages[1]!.content).toContain('[truncated]');
    expect(req.messages[1]!.content.length).toBeLessThan(
      MAX_NLSQL_QUESTION_CHARS + MAX_NLSQL_SCHEMA_CHARS + 500
    );
  });

  it('passes the model through when provided', () => {
    const req = buildNlToSqlRequest({
      question: 'x',
      schemaText: 't(a INT)',
      model: 'qwen3-coder:latest',
    });
    expect(req.model).toBe('qwen3-coder:latest');
  });
});
