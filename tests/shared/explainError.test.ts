/**
 * "Explain this error" request builder + redaction.
 *
 * The core is pure (no network); these tests pin the redaction posture and
 * the consent-preview construction that the AI feature's "no silent network
 * call" guarantee rests on.
 */

import { describe, expect, it } from 'vitest';
import {
  answerLanguageFor,
  buildExplainErrorRequest,
  redactSecretsFromCode,
  MAX_EXPLAIN_CODE_CHARS, formatRuntimeValues } from '../../src/shared/ai/explainError';
import { FAKE_GITHUB_PAT, FAKE_JWT } from './secret.fixtures';

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
      `client.use("sk-ant-abcdefghijklmnop1234")\n// ${FAKE_GITHUB_PAT}`
    );
    expect(code).not.toContain('sk-ant-abcdefghijklmnop1234');
    expect(code).not.toContain(FAKE_GITHUB_PAT);
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

describe('answer language', () => {
  it('asks for the UI language only when it is not English', () => {
    expect(answerLanguageFor('es')).toBe('Spanish');
    expect(answerLanguageFor('es-MX')).toBe('Spanish');
    expect(answerLanguageFor('en')).toBeUndefined();
    const spanish = buildExplainErrorRequest({
      errorMessage: 'TypeError',
      code: 'x.y',
      language: 'javascript',
      answerLanguage: 'Spanish',
    });
    expect(spanish.messages[1]!.content).toContain('Answer in: Spanish\n');
    expect(spanish.preview).toContain('Answer in: Spanish');
    const english = buildExplainErrorRequest({ errorMessage: 'TypeError', code: 'x.y', language: 'javascript' });
    expect(english.messages[1]!.content).not.toContain('Answer in:');
  });
});

describe('runtime values', () => {
  it('hides secret names, masks token values and caps each value', () => {
    const { code, redactedCount } = formatRuntimeValues({
      apiKey: 'plain-looking',
      session: FAKE_JWT,
      user: '{ id: 7,\n  profile: null }',
      long: 'x'.repeat(300),
    });
    expect(code.split('\n')).toEqual([
      'apiKey = <redacted>',
      'session = <redacted>',
      'user = { id: 7, profile: null }',
      `long = ${'x'.repeat(200)}…`,
    ]);
    expect(redactedCount).toBe(2);
  });

  it('adds them to the payload and the preview only when given', () => {
    const base = { errorMessage: 'TypeError: x', code: 'let user = null;', language: 'javascript' };
    expect(buildExplainErrorRequest(base).preview).not.toContain('Runtime values');
    const withValues = buildExplainErrorRequest({ ...base, runtimeValues: { user: 'null', token: 'abc' } });
    expect(withValues.messages[1]!.content).toContain('Runtime values:\nuser = null\ntoken = <redacted>');
    expect(withValues.preview).toContain('token = <redacted>');
    expect(withValues.redactedCount).toBe(1);
  });
});
