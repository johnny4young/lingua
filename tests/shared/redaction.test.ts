/**
 * RL-094 Slice 1 — `src/shared/redaction.ts` extract proof.
 *
 * These tests assert two contracts:
 *
 *   1. Pure-module correctness: the extracted helpers behave the same
 *      way the telemetry redactor did before the move.
 *   2. Parity with telemetry: the telemetry tests still pass against
 *      the post-extract import wiring (covered by the existing
 *      `tests/shared/telemetry.test.ts` suite, run by the same CI
 *      pass — no work needed here).
 */

import { describe, expect, it } from 'vitest';
import {
  DENY_SUBSTRINGS,
  REDACTION_VERSION,
  keyLooksSensitive,
  redactFlatRecord,
  valueLooksSensitive,
} from '../../src/shared/redaction';

describe('DENY_SUBSTRINGS', () => {
  it('contains the canonical sensitive substrings', () => {
    expect(DENY_SUBSTRINGS).toEqual([
      'content',
      'code',
      'source',
      'snippet',
      'file',
      'path',
      'apikey',
      'api_key',
      'secret',
      'credential',
      'authorization',
      'privatekey',
      'private_key',
      'accesskey',
      'access_key',
      'licensekey',
      'license_key',
      'token',
      'password',
      'email',
      'name',
      'project',
    ]);
  });
});

describe('REDACTION_VERSION', () => {
  it('is a non-empty ISO-style date string', () => {
    expect(typeof REDACTION_VERSION).toBe('string');
    expect(REDACTION_VERSION.length).toBeGreaterThanOrEqual(10);
    expect(REDACTION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/u);
  });
});

describe('keyLooksSensitive', () => {
  it('matches case-insensitively against every DENY substring', () => {
    for (const deny of DENY_SUBSTRINGS) {
      expect(keyLooksSensitive(deny)).toBe(true);
      expect(keyLooksSensitive(deny.toUpperCase())).toBe(true);
      expect(keyLooksSensitive(`my_${deny}_id`)).toBe(true);
    }
  });

  it('returns false for unrelated keys', () => {
    expect(keyLooksSensitive('language')).toBe(false);
    expect(keyLooksSensitive('status')).toBe(false);
    expect(keyLooksSensitive('kind')).toBe(false);
    expect(keyLooksSensitive('trigger')).toBe(false);
  });

  it('matches common credential key shapes that are not lowercase token', () => {
    expect(keyLooksSensitive('apiKey')).toBe(true);
    expect(keyLooksSensitive('privateKeyPem')).toBe(true);
    expect(keyLooksSensitive('access_key_id')).toBe(true);
    expect(keyLooksSensitive('authorizationHeader')).toBe(true);
    expect(keyLooksSensitive('licenseKey')).toBe(true);
  });
});

describe('valueLooksSensitive', () => {
  it('accepts primitives + null', () => {
    expect(valueLooksSensitive(null)).toBe(false);
    expect(valueLooksSensitive('hello')).toBe(false);
    expect(valueLooksSensitive(42)).toBe(false);
    expect(valueLooksSensitive(true)).toBe(false);
  });

  it('rejects objects + arrays + Buffer-shaped values', () => {
    expect(valueLooksSensitive({})).toBe(true);
    expect(valueLooksSensitive([])).toBe(true);
    expect(valueLooksSensitive(new Uint8Array(8))).toBe(true);
    expect(valueLooksSensitive(() => {})).toBe(true);
  });

  it('rejects undefined (which telemetry treats as missing)', () => {
    expect(valueLooksSensitive(undefined)).toBe(true);
  });
});

describe('redactFlatRecord', () => {
  it('keeps primitive entries with safe keys', () => {
    const out = redactFlatRecord({
      language: 'javascript',
      status: 'ok',
      durationMs: 42,
      enabled: true,
    });
    expect(out.surviving).toEqual({
      language: 'javascript',
      status: 'ok',
      durationMs: 42,
      enabled: true,
    });
    expect(out.dropped).toEqual([]);
  });

  it('drops keys matching DENY_SUBSTRINGS with reason:key', () => {
    const out = redactFlatRecord({
      sourceContent: 'console.log("hi")',
      filePath: '/Users/me/secret.js',
      apiKey: 'sk-test',
      token: 'abc',
      language: 'javascript',
    });
    expect(out.surviving).toEqual({ language: 'javascript' });
    const droppedKeys = out.dropped.map((d) => d.key).sort();
    expect(droppedKeys).toEqual(['apiKey', 'filePath', 'sourceContent', 'token']);
    expect(out.dropped.every((d) => d.reason === 'key')).toBe(true);
  });

  it('drops non-primitive values with reason:value', () => {
    const out = redactFlatRecord({
      meta: { nested: 'oops' },
      list: [1, 2, 3],
      status: 'ok',
    });
    expect(out.surviving).toEqual({ status: 'ok' });
    const droppedReasons = out.dropped.map((d) => d.reason).sort();
    expect(droppedReasons).toEqual(['value', 'value']);
  });
});
