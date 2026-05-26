/**
 * RL-094 Slice 2 — tests for `tryDecodeCapsuleJson`.
 *
 * Exercises every closed-enum reject reason + the happy path; relies
 * on the existing fixture catalog to keep the schema-side contract
 * pinned without duplicating capsule construction here.
 */

import { describe, it, expect } from 'vitest';
import {
  tryDecodeCapsuleJson,
  type CapsuleImportDecodeResult,
} from '../../../src/renderer/utils/importCapsule';
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_LARGE_STDOUT,
} from '../../shared/runCapsule.fixtures';
import {
  MAX_CAPSULE_BYTES,
  type RunCapsuleV1,
} from '../../../src/shared/runCapsule';

function payload(capsule: RunCapsuleV1): string {
  return JSON.stringify(capsule);
}

describe('tryDecodeCapsuleJson', () => {
  it('decodes a minimal valid capsule and stamps the size bucket', () => {
    const result = tryDecodeCapsuleJson(payload(FIXTURE_MINIMAL_JS));
    if (!result.ok) throw new Error('expected ok');
    expect(result.capsule.version).toBe(1);
    expect(result.capsule.tab.language).toBe('javascript');
    expect(result.byteLength).toBeGreaterThan(0);
    expect(result.sizeBucket).toBe('<10kb');
  });

  it('decodes a larger fixture and bucketed correctly', () => {
    const result = tryDecodeCapsuleJson(payload(FIXTURE_LARGE_STDOUT));
    if (!result.ok) throw new Error('expected ok');
    expect(result.byteLength).toBeGreaterThan(10_000);
    // FIXTURE_LARGE_STDOUT pre-truncates to ~1 MiB so it stays under
    // the import cap. The bucket should reflect the serialized size.
    expect(['<100kb', '<1mb', '<4mb']).toContain(result.sizeBucket);
  });

  it('rejects empty string', () => {
    const result = tryDecodeCapsuleJson('');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty');
    expect(result.byteLength).toBe(0);
  });

  it('rejects whitespace-only input as empty', () => {
    const result = tryDecodeCapsuleJson('   \n\t  ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty');
  });

  it('rejects malformed JSON', () => {
    const result = tryDecodeCapsuleJson('{not-json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed-json');
    expect(result.detail).toBeDefined();
  });

  it('rejects a non-object root', () => {
    const result = tryDecodeCapsuleJson('[1, 2, 3]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-shape');
  });

  it('rejects a non-1 version field', () => {
    const future = { ...FIXTURE_MINIMAL_JS, version: 2 as 1 };
    const result = tryDecodeCapsuleJson(JSON.stringify(future));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('wrong-version');
    expect(result.detail).toMatch(/version=2/);
  });

  it('rejects oversized payload', () => {
    const oversized = 'x'.repeat(MAX_CAPSULE_BYTES + 10);
    const result = tryDecodeCapsuleJson(oversized);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('oversized');
  });

  it('rejects when source fields are wrong type', () => {
    const broken = {
      ...FIXTURE_MINIMAL_JS,
      source: { content: 123 as unknown as string, contentHash: 'abc' },
    };
    const result = tryDecodeCapsuleJson(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-shape');
  });

  it('rejects when required field is missing', () => {
    const broken: Partial<RunCapsuleV1> = { ...FIXTURE_MINIMAL_JS };
    delete broken.environment;
    const result = tryDecodeCapsuleJson(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-shape');
  });

  it('trims leading/trailing whitespace before parsing', () => {
    const padded = `   \n${payload(FIXTURE_MINIMAL_JS)}\n   `;
    const result = tryDecodeCapsuleJson(padded);
    expect(result.ok).toBe(true);
  });

  it('round-trips every closed-enum reject reason without throwing', () => {
    const cases: Array<{ input: string; reason: string }> = [
      { input: '', reason: 'empty' },
      { input: '{bad', reason: 'malformed-json' },
      { input: '[]', reason: 'invalid-shape' },
      { input: JSON.stringify({ version: 0 }), reason: 'wrong-version' },
    ];
    for (const { input, reason } of cases) {
      const result: CapsuleImportDecodeResult = tryDecodeCapsuleJson(input);
      if (result.ok) {
        throw new Error(`expected reject for input ${input}`);
      }
      expect(result.reason).toBe(reason);
    }
  });

  it('non-string input is treated as empty input', () => {
    const result = tryDecodeCapsuleJson(undefined as unknown as string);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty');
  });

  it('reports byteLength in UTF-8 (not UTF-16 char count)', () => {
    // 4-byte UTF-8 emoji vs 2 UTF-16 code units.
    const value = '🚀';
    const result = tryDecodeCapsuleJson(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The string itself is malformed JSON, but the byteLength must
    // reflect 4 UTF-8 bytes (not 2 UTF-16 code units).
    expect(result.byteLength).toBe(4);
  });

  it('rejects on a deeply nested wrong shape (regression for invalid-shape mapping)', () => {
    const broken = {
      ...FIXTURE_MINIMAL_JS,
      // Privacy.omittedFields must be string[], not string.
      privacy: {
        redactionVersion: FIXTURE_MINIMAL_JS.privacy.redactionVersion,
        omittedFields: 'not-an-array' as unknown as string[],
      },
    };
    const result = tryDecodeCapsuleJson(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-shape');
  });
});
