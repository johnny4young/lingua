import { describe, expect, it } from 'vitest';
import {
  decodeUlid,
  decodeUuidV7,
  generateUlid,
  generateUuidV7,
  inspectIdentifier,
} from '@/utils/uuid';

describe('generateUuidV7', () => {
  it('produces the canonical 8-4-4-4-12 shape with version + variant bits set', () => {
    const uuid = generateUuidV7(new Date(0));
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('embeds the requested timestamp into the first 48 bits', () => {
    const fixed = new Date('2024-06-15T10:00:00Z');
    const uuid = generateUuidV7(fixed);
    const hex = uuid.replaceAll('-', '').slice(0, 12);
    expect(Number.parseInt(hex, 16)).toBe(fixed.getTime());
  });

  it('decodes cleanly back to the same millisecond', () => {
    const now = new Date();
    const uuid = generateUuidV7(now);
    const decoded = decodeUuidV7(uuid);
    expect(decoded).not.toBeNull();
    expect(decoded?.kind).toBe('uuid-v7');
    expect(decoded?.timestamp?.getTime()).toBe(now.getTime());
  });

  it('two consecutive generations never move the timestamp backwards', () => {
    const a = generateUuidV7(new Date(10));
    const b = generateUuidV7(new Date(11));
    const msA = Number.parseInt(a.replaceAll('-', '').slice(0, 12), 16);
    const msB = Number.parseInt(b.replaceAll('-', '').slice(0, 12), 16);
    expect(msB).toBeGreaterThanOrEqual(msA);
  });

  it('rejects malformed input from the decoder', () => {
    expect(decodeUuidV7('not-a-uuid')).toBeNull();
    // Valid UUID but wrong version (v4 here).
    expect(decodeUuidV7('9f3b7fb8-1f0e-4d25-9a8d-6a5b84e17d9a')).toBeNull();
    expect(decodeUuidV7('')).toBeNull();
  });
});

describe('generateUlid / decodeUlid', () => {
  it('produces a 26-character Crockford Base32 string', () => {
    const ulid = generateUlid(new Date(0));
    expect(ulid).toHaveLength(26);
    expect(ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('round-trips the embedded timestamp', () => {
    const now = new Date('2024-06-15T10:00:00Z');
    const ulid = generateUlid(now);
    const decoded = decodeUlid(ulid);
    expect(decoded).not.toBeNull();
    expect(decoded?.kind).toBe('ulid');
    expect(decoded?.timestamp?.getTime()).toBe(now.getTime());
  });

  it('rejects a ULID that uses disallowed Crockford characters', () => {
    // L, I, O, U are excluded from Crockford Base32.
    expect(decodeUlid('IIIIIIIIIIIIIIIIIIIIIIIIII')).toBeNull();
    expect(decodeUlid('01H8XA7G3F5XMZ7A9Q1E2B3C4')).toBeNull(); // 25 chars
    expect(decodeUlid('')).toBeNull();
  });
});

describe('inspectIdentifier', () => {
  it('recognizes UUID v4 without a timestamp field', () => {
    const result = inspectIdentifier('9f3b7fb8-1f0e-4d25-9a8d-6a5b84e17d9a');
    expect(result?.kind).toBe('uuid-v4');
    expect(result?.timestamp).toBeUndefined();
  });

  it('recognizes UUID v7 and surfaces the timestamp', () => {
    const v7 = generateUuidV7(new Date('2020-01-01T00:00:00Z'));
    const result = inspectIdentifier(v7);
    expect(result?.kind).toBe('uuid-v7');
    expect(result?.timestamp?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  it('recognizes ULID and surfaces the timestamp', () => {
    const ulid = generateUlid(new Date('2021-03-15T12:34:56Z'));
    const result = inspectIdentifier(ulid);
    expect(result?.kind).toBe('ulid');
    expect(result?.timestamp?.toISOString()).toBe('2021-03-15T12:34:56.000Z');
  });

  it('returns null for unrecognized input', () => {
    expect(inspectIdentifier('hello world')).toBeNull();
    expect(inspectIdentifier('')).toBeNull();
    expect(inspectIdentifier('123')).toBeNull();
  });
});
