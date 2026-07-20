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
