/**
 * T19 / RL-031 Slice 1 — "Explain this error" request builder + redaction.
 *
 * The core is pure (no network); these tests pin the redaction posture and
 * the consent-preview construction that the AI feature's "no silent network
 * call" guarantee rests on.
 */

import { describe, expect, it } from 'vitest';
import {
  buildExplainErrorRequest,
  redactSecretsFromCode,
  MAX_EXPLAIN_CODE_CHARS,
} from '../../src/shared/ai/explainError';

describe('redactSecretsFromCode', () => {
  it('masks a string assigned to a secret-looking identifier', () => {
    const { code, redactedCount } = redactSecretsFromCode(
      'API_KEY = "super-secret-value"\nname = "alice"'
    );
    expect(code).toContain('API_KEY = "<redacted>"');
    expect(code).toContain('name = "alice"'); // non-secret name untouched
    expect(redactedCount).toBe(1);
  });

  it('masks secret assignments across = and : syntaxes', () => {
    const { code } = redactSecretsFromCode(
      "const password = 'p@ss'\npassword: 'other'"
    );
    expect(code).not.toContain('p@ss');
    expect(code).not.toContain("'other'");
    expect(code).toContain('<redacted>');
  });

  it('masks token-shaped values anywhere, regardless of name', () => {
    const { code, redactedCount } = redactSecretsFromCode(
      'client.use("sk-ant-abcdefghijklmnop1234")\n// ghp_ABCDEFGHIJKLMNOPQRSTUVWX'
    );
    expect(code).not.toContain('sk-ant-abcdefghijklmnop1234');
    expect(code).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWX');
    expect(redactedCount).toBeGreaterThanOrEqual(2);
  });

  it('leaves secret-free code untouched (no false positives on plain code)', () => {
    const src = 'def add(a, b):\n    return a + b\nprint(add(1, 2))';
    const { code, redactedCount } = redactSecretsFromCode(src);
    expect(code).toBe(src);
    expect(redactedCount).toBe(0);
  });
});

describe('buildExplainErrorRequest', () => {
  it('builds system + user messages with the error and code', () => {
    const req = buildExplainErrorRequest({
      errorMessage: "NameError: name 'x' is not defined",
      code: 'print(x)',
      language: 'python',
      filename: 'main.py',
    });
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]!.role).toBe('system');
    expect(req.messages[1]!.role).toBe('user');
    expect(req.messages[1]!.content).toContain('NameError');
    expect(req.messages[1]!.content).toContain('print(x)');
    expect(req.messages[1]!.content).toContain('Language: python (main.py)');
  });

  it('redacts secrets in the code by default and flags it', () => {
    const req = buildExplainErrorRequest({
      errorMessage: 'boom',
      code: 'TOKEN = "sk-ant-abcdefghijklmnop1234"',
      language: 'python',
    });
    expect(req.redacted).toBe(true);
    // The consent surface renders "N secrets redacted" from the count, so the
    // request exposes the number — not just the boolean (Local AI ADR).
    expect(req.redactedCount).toBe(1);
    expect(req.messages[1]!.content).not.toContain('sk-ant-abcdefghijklmnop1234');
    // The preview shows exactly what would be sent — also redacted.
    expect(req.preview).not.toContain('sk-ant-abcdefghijklmnop1234');
  });

  it('can be told not to redact (redact: false)', () => {
    const req = buildExplainErrorRequest({
      errorMessage: 'boom',
      code: 'API_KEY = "keep-me"',
      language: 'javascript',
      redact: false,
    });
    expect(req.redacted).toBe(false);
    expect(req.messages[1]!.content).toContain('keep-me');
  });

  it('exposes a consent preview mirroring the message payload', () => {
    const req = buildExplainErrorRequest({
      errorMessage: 'boom',
      code: 'x',
      language: 'python',
    });
    expect(req.preview).toContain('will be sent to your configured AI endpoint');
    expect(req.preview).toContain('[system]');
    expect(req.preview).toContain('[user]');
  });

  it('bounds a huge code excerpt so it cannot be sent by accident', () => {
    const req = buildExplainErrorRequest({
      errorMessage: 'boom',
      code: 'a'.repeat(MAX_EXPLAIN_CODE_CHARS + 5000),
      language: 'python',
    });
    expect(req.messages[1]!.content).toContain('[truncated]');
    expect(req.messages[1]!.content.length).toBeLessThan(
      MAX_EXPLAIN_CODE_CHARS + 500
    );
  });

  it('passes a model id through when provided', () => {
    const req = buildExplainErrorRequest({
      errorMessage: 'boom',
      code: 'x',
      language: 'python',
      model: 'gpt-4o-mini',
    });
    expect(req.model).toBe('gpt-4o-mini');
  });

  it('includes the runtime note in the user content AND the consent preview', () => {
    const req = buildExplainErrorRequest({
      errorMessage: 'boom',
      code: 'x',
      language: 'python',
      runtimeNote: 'Python runs on Pyodide: micropip only.',
    });
    expect(req.messages[1]!.content).toContain(
      'Runtime: Python runs on Pyodide: micropip only.'
    );
    // Consent honesty: context added to the payload is context the user sees.
    expect(req.preview).toContain('Runtime: Python runs on Pyodide');
  });

  it('omits the Runtime line entirely when no note is provided', () => {
    const req = buildExplainErrorRequest({
      errorMessage: 'boom',
      code: 'x',
      language: 'python',
    });
    expect(req.messages[1]!.content).not.toContain('Runtime:');
  });
});
