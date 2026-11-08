import { describe, expect, it } from 'vitest';
import {
  buildExplainCodeRequest,
  MAX_EXPLAIN_CODE_QUESTION_CHARS,
} from '../../src/shared/ai/explainCode';
import { MAX_EXPLAIN_CODE_CHARS } from '../../src/shared/ai/explainError';

describe('buildExplainCodeRequest', () => {
  it('builds a system+user message pair and a verbatim preview', () => {
    const req = buildExplainCodeRequest({
      code: 'const x = 1;',
      language: 'javascript',
      filename: 'scratch.js',
    });
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]!.role).toBe('system');
    expect(req.messages[1]!.role).toBe('user');
    expect(req.messages[1]!.content).toContain('const x = 1;');
    expect(req.messages[1]!.content).toContain('javascript');
    expect(req.messages[1]!.content).toContain('scratch.js');
    // The preview is exactly the messages, so the consent surface can show it.
    expect(req.preview).toContain('const x = 1;');
    expect(req.preview).toContain('[system]');
    expect(req.preview).toContain('[user]');
  });

  it('defaults to an "explain what this does" ask when no question is given', () => {
    const req = buildExplainCodeRequest({ code: 'x=1', language: 'python' });
    expect(req.messages[1]!.content).toContain('Explain what this code does.');
  });

  it('includes and clips a free-text question when provided', () => {
    const req = buildExplainCodeRequest({
      code: 'x=1',
      language: 'python',
      question: 'q'.repeat(MAX_EXPLAIN_CODE_QUESTION_CHARS + 50),
    });
    expect(req.messages[1]!.content).toContain('Question:');
    expect(req.messages[1]!.content).toContain('[truncated]');
  });

  it('redacts obvious secrets and reports the count', () => {
    const req = buildExplainCodeRequest({
      code: 'const API_KEY = "sk-abcdefghijklmnopqrstuvwxyz";',
      language: 'javascript',
    });
    expect(req.redacted).toBe(true);
    expect(req.redactedCount).toBeGreaterThan(0);
    expect(req.preview).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(req.preview).toContain('<redacted>');
  });

  it('bounds a huge buffer', () => {
    const req = buildExplainCodeRequest({
      code: 'a'.repeat(MAX_EXPLAIN_CODE_CHARS + 500),
      language: 'javascript',
    });
    expect(req.messages[1]!.content).toContain('[truncated]');
  });

  it('passes through the model id when set', () => {
    const req = buildExplainCodeRequest({
      code: 'x=1',
      language: 'python',
      model: 'qwen3-coder',
    });
    expect(req.model).toBe('qwen3-coder');
  });
});

describe('buildExplainCodeRequest answer language', () => {
  it('adds the answer language to the user turn', () => {
    const req = buildExplainCodeRequest({ code: 'x=1', language: 'python', answerLanguage: 'Spanish' });
    expect(req.messages[1]!.content).toContain('Answer in: Spanish\n');
  });

  it('attaches the last run after the code, redacted and counted', () => {
    const fakeKey = ['sk', 'ant', 'abcdefghijklmnop1234'].join('-');
    const req = buildExplainCodeRequest({
      code: 'print(sorted(xs))',
      language: 'python',
      question: 'why are duplicates gone?',
      lastRun: `[1, 2]\nkey ${fakeKey}`,
    });
    const user = req.messages[1]!.content;
    expect(user).toContain('Question: why are duplicates gone?');
    expect(user.indexOf('Last run:')).toBeGreaterThan(user.indexOf('print(sorted(xs))'));
    expect(user).toContain('[1, 2]');
    expect(user).not.toContain(fakeKey);
    expect(req.redactedCount).toBe(1);
    expect(req.redacted).toBe(true);
  });

  it('masks connection strings and secret pairs in the last run', () => {
    const user = buildExplainCodeRequest({ code: 'x', language: 'python', lastRun: 'DATABASE_URL=postgres://admin:hunter2pass@db/app\n{ password: hunter2 }' }).messages[1]!.content;
    expect(user).not.toContain('hunter2pass');
    expect(user).not.toContain('password: hunter2');
  });

  it('caps the last run and leaves it out when blank', () => {
    const long = buildExplainCodeRequest({ code: 'x', language: 'python', lastRun: 'y'.repeat(5_000) }).messages[1]!.content;
    expect(long).toContain('… [truncated]');
    expect(long).not.toContain('y'.repeat(2_001));
    expect(buildExplainCodeRequest({ code: 'x', language: 'python', lastRun: '  ' }).messages[1]!.content).not.toContain('Last run:');
  });
});
