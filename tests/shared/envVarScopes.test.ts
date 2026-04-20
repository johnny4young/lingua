/**
 * RL-011 Slice A tests — lock the scope-merger contract so future
 * store plumbing + Settings UI slices can't drift on the precedence,
 * the empty-string-as-real-value POSIX rule, the key validator, or
 * the reserved-key deny list.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_KEY_LENGTH,
  MAX_SCOPE_KEYS,
  MAX_VALUE_LENGTH,
  mergeEnvScopes,
  sanitizeScope,
  traceEnvScopes,
  validateEnvVarKey,
} from '../../src/shared/envVarScopes';

describe('validateEnvVarKey', () => {
  it('accepts canonical POSIX names', () => {
    for (const key of ['FOO', '_BAR', 'GOOS', 'RUSTFLAGS', 'a1', '_9']) {
      expect(validateEnvVarKey(key).ok).toBe(true);
    }
  });

  it('rejects empty or undefined keys', () => {
    expect(validateEnvVarKey('')).toEqual({ ok: false, reason: 'empty' });
    // @ts-expect-error — defensive runtime check
    expect(validateEnvVarKey(undefined)).toEqual({ ok: false, reason: 'empty' });
  });

  it('distinguishes leading-digit from other invalid-character cases', () => {
    expect(validateEnvVarKey('1FOO')).toEqual({
      ok: false,
      reason: 'invalid-leading-character',
    });
    expect(validateEnvVarKey('FOO BAR')).toEqual({
      ok: false,
      reason: 'invalid-character',
    });
    expect(validateEnvVarKey('FOO-BAR')).toEqual({
      ok: false,
      reason: 'invalid-character',
    });
  });

  it('caps key length', () => {
    const tooLong = 'A'.repeat(MAX_KEY_LENGTH + 1);
    expect(validateEnvVarKey(tooLong)).toEqual({ ok: false, reason: 'too-long' });
  });

  it('refuses to let the user override host-critical names', () => {
    for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'LOGNAME', 'PWD', 'OLDPWD']) {
      expect(validateEnvVarKey(key)).toEqual({ ok: false, reason: 'reserved-prefix' });
    }
  });
});

describe('sanitizeScope', () => {
  it('returns an empty scope for undefined input', () => {
    expect(sanitizeScope(undefined)).toEqual({});
  });

  it('drops invalid keys silently and keeps valid ones', () => {
    expect(
      sanitizeScope({
        FOO: 'bar',
        '1BAD': 'x',
        'WITH SPACE': 'x',
        PATH: 'nope',
        OK_KEY: 'value',
      })
    ).toEqual({ FOO: 'bar', OK_KEY: 'value' });
  });

  it('drops non-string values defensively', () => {
    const scope = sanitizeScope({
      FOO: 'ok',
      // @ts-expect-error — simulate runtime bad data
      BAR: 42,
      // @ts-expect-error — simulate runtime bad data
      BAZ: null,
    } as unknown as Record<string, string>);
    expect(scope).toEqual({ FOO: 'ok' });
  });

  it('caps per-scope key count', () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < MAX_SCOPE_KEYS + 10; i += 1) {
      input[`K${i}`] = 'v';
    }
    const sanitized = sanitizeScope(input);
    expect(Object.keys(sanitized).length).toBe(MAX_SCOPE_KEYS);
  });

  it('caps per-value length', () => {
    const sanitized = sanitizeScope({
      OK: 'x',
      HUGE: 'a'.repeat(MAX_VALUE_LENGTH + 1),
    });
    expect('OK' in sanitized).toBe(true);
    expect('HUGE' in sanitized).toBe(false);
  });
});

describe('mergeEnvScopes precedence', () => {
  it('tab > project > global > processEnv', () => {
    const merged = mergeEnvScopes({
      processEnv: { FOO: 'p', LEVEL: 'process' },
      global: { FOO: 'g', LEVEL: 'global' },
      project: { FOO: 'j', LEVEL: 'project' },
      tab: { FOO: 't', LEVEL: 'tab' },
    });
    expect(merged.FOO).toBe('t');
    expect(merged.LEVEL).toBe('tab');
  });

  it('falls back down each tier when higher tiers are absent', () => {
    expect(mergeEnvScopes({ project: { FOO: 'j' }, global: { FOO: 'g' } }).FOO).toBe('j');
    expect(mergeEnvScopes({ global: { FOO: 'g' }, processEnv: { FOO: 'p' } }).FOO).toBe('g');
    expect(mergeEnvScopes({ processEnv: { FOO: 'p' } }).FOO).toBe('p');
  });

  it('empty-string values preserve at every tier (POSIX mask semantics)', () => {
    // Tab masks project
    expect(
      mergeEnvScopes({
        project: { KEY: 'project-value' },
        tab: { KEY: '' },
      }).KEY
    ).toBe('');

    // Empty-string tab does not leak undefined into the merged object
    expect('KEY' in mergeEnvScopes({ tab: { KEY: '' } })).toBe(true);
  });

  it('returns a frozen object so callers cannot mutate the merged env', () => {
    const merged = mergeEnvScopes({ tab: { FOO: 'bar' } });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(() => {
      (merged as Record<string, string>).FOO = 'mutated';
    }).toThrow();
  });

  it('ignores invalid keys introduced at any tier', () => {
    const merged = mergeEnvScopes({
      global: { PATH: 'hostile-override' },
      tab: { '123': 'x', FOO: 'ok' },
    });
    expect('PATH' in merged).toBe(false);
    expect('123' in merged).toBe(false);
    expect(merged.FOO).toBe('ok');
  });
});

describe('traceEnvScopes', () => {
  it('records the resolved tier for each key', () => {
    const trace = traceEnvScopes({
      processEnv: { P_ONLY: 'p' },
      global: { G_ONLY: 'g', OVERRIDDEN: 'g' },
      project: { OVERRIDDEN: 'j' },
      tab: { T_ONLY: 't' },
    });
    expect(trace.P_ONLY).toEqual({ value: 'p', from: 'processEnv' });
    expect(trace.G_ONLY).toEqual({ value: 'g', from: 'global' });
    expect(trace.OVERRIDDEN).toEqual({ value: 'j', from: 'project' });
    expect(trace.T_ONLY).toEqual({ value: 't', from: 'tab' });
  });
});
