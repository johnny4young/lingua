import { describe, expect, it } from 'vitest';
import {
  BASELINE_SENSITIVE_HEADERS,
  isBaselineSensitiveHttpHeader,
} from '../../src/shared/httpSensitiveHeaders';
import { BASELINE_SENSITIVE_HEADERS as LEGACY_BASELINE } from '../../src/shared/httpWorkspace';

describe('HTTP sensitive-header policy', () => {
  it('keeps one canonical lowercase baseline', () => {
    expect(BASELINE_SENSITIVE_HEADERS).toEqual([
      'authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'x-auth-token',
      'proxy-authorization',
    ]);
    expect(new Set(BASELINE_SENSITIVE_HEADERS).size).toBe(BASELINE_SENSITIVE_HEADERS.length);
    expect(BASELINE_SENSITIVE_HEADERS.every(name => name === name.toLowerCase())).toBe(true);
  });

  it('matches normalized exact names and rejects lookalikes', () => {
    expect(isBaselineSensitiveHttpHeader(' Authorization ')).toBe(true);
    expect(isBaselineSensitiveHttpHeader('X-API-KEY')).toBe(true);
    expect(isBaselineSensitiveHttpHeader('Document-Authorization-Date')).toBe(false);
    expect(isBaselineSensitiveHttpHeader('')).toBe(false);
    expect(isBaselineSensitiveHttpHeader(123)).toBe(false);
  });

  it('preserves the historical HTTP workspace export', () => {
    expect(LEGACY_BASELINE).toBe(BASELINE_SENSITIVE_HEADERS);
  });
});
