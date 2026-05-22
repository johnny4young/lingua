import { describe, expect, it } from 'vitest';
import {
  applyRedactionPreview,
  DENY_SUBSTRINGS,
} from '@/utils/redactionPreview';

describe('applyRedactionPreview', () => {
  it('returns an empty result for empty input', () => {
    const result = applyRedactionPreview('');
    expect(result.redacted).toBe('');
    expect(result.hadJsonShape).toBe(false);
    expect(result.droppedKeys).toEqual([]);
  });

  it('routes JSON objects through the canonical redactFlatRecord pipeline', () => {
    const result = applyRedactionPreview(
      JSON.stringify({
        language: 'python',
        apiKey: 'sk-test-1234567890abcdefghijklmnop',
        token: 'sk-abc123',
        licenseKey: 'lic_123',
        email: 'a@b.com',
        durationBucketMs: 250,
      })
    );
    expect(result.hadJsonShape).toBe(true);
    const reparsed = JSON.parse(result.redacted);
    // `language` and `durationBucketMs` survive because they don't
    // match DENY_SUBSTRINGS; `token` + `email` get replaced with the
    // <redacted> sentinel.
    expect(reparsed.language).toBe('python');
    expect(reparsed.durationBucketMs).toBe(250);
    expect(reparsed.apiKey).toBe('<redacted>');
    expect(reparsed.token).toBe('<redacted>');
    expect(reparsed.licenseKey).toBe('<redacted>');
    expect(reparsed.email).toBe('<redacted>');
    const droppedKeys = result.droppedKeys.map((d) => d.key);
    expect(droppedKeys).toContain('apiKey');
    expect(droppedKeys).toContain('token');
    expect(droppedKeys).toContain('licenseKey');
    expect(droppedKeys).toContain('email');
  });

  it('scans free-form text for key=value pairs whose key matches DENY_SUBSTRINGS', () => {
    const input = `# config snippet
token = sk-abc-123
email: user@example.com
language = python
path = /Users/me/secret.py`;
    const result = applyRedactionPreview(input);
    expect(result.hadJsonShape).toBe(false);
    expect(result.redacted).toMatch(/token = <redacted>/u);
    expect(result.redacted).toMatch(/email: <redacted>/u);
    expect(result.redacted).toMatch(/path = <redacted>/u);
    // `language = python` is NOT in DENY_SUBSTRINGS, survives.
    expect(result.redacted).toMatch(/language = python/u);
  });

  it('handles multiline + emoji + non-ASCII without crashing', () => {
    const input = '🦀 Rust\ntoken = abc\néxito = sí';
    expect(() => applyRedactionPreview(input)).not.toThrow();
    const result = applyRedactionPreview(input);
    expect(result.redacted).toContain('🦀 Rust');
    expect(result.redacted).toContain('token = <redacted>');
  });

  it('preserves DENY_SUBSTRINGS as the canonical source of sensitive keys', () => {
    // Smoke check: the exported list is non-empty AND contains the
    // canonical Lingua keys. If a future redaction.ts change shrinks
    // the list, this test fires.
    expect(DENY_SUBSTRINGS.length).toBeGreaterThanOrEqual(10);
    expect(DENY_SUBSTRINGS).toContain('token');
    expect(DENY_SUBSTRINGS).toContain('email');
    expect(DENY_SUBSTRINGS).toContain('password');
  });
});
