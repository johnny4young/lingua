/**
 * RL-099 Slice 1 — utility adapter unit tests.
 *
 * Covers all 5 adapters (json-format, base64-encode / decode,
 * url-parse, regex-replace, diff-text) — happy path + reject path
 * + parseOptions shape guard. Keeps the test surface single-file
 * since each adapter is small.
 */

import { describe, expect, it } from 'vitest';
import { base64DecodeAdapter, base64EncodeAdapter } from '../../../src/shared/utilities/base64';
import { diffTextAdapter } from '../../../src/shared/utilities/diffText';
import { jsonFormatAdapter } from '../../../src/shared/utilities/jsonFormat';
import { regexReplaceAdapter } from '../../../src/shared/utilities/regexReplace';
import { urlParseAdapter } from '../../../src/shared/utilities/urlParse';
import { UTILITY_ADAPTER_REGISTRY } from '../../../src/shared/utilities/registry';

describe('UTILITY_ADAPTER_REGISTRY', () => {
  it('exposes all 6 closed-enum adapters', () => {
    expect(Object.keys(UTILITY_ADAPTER_REGISTRY).sort()).toEqual([
      'base64-decode',
      'base64-encode',
      'diff-text',
      'json-format',
      'regex-replace',
      'url-parse',
    ]);
  });
});

describe('jsonFormatAdapter', () => {
  it('pretty-prints with 2-space indent', async () => {
    const r = await jsonFormatAdapter.run('{"a":1}', { indent: '2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe('{\n  "a": 1\n}');
  });

  it('minifies', async () => {
    const r = await jsonFormatAdapter.run('{ "a":  1 }', { indent: 'minified' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value).toBe('{"a":1}');
  });

  it('rejects invalid JSON', async () => {
    const r = await jsonFormatAdapter.run('{not json', { indent: '2' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });

  it('parseOptions rejects unknown indent value', () => {
    expect(jsonFormatAdapter.parseOptions({ indent: 'wat' })).toBeNull();
  });
});

describe('base64 adapters', () => {
  it('encodes UTF-8', async () => {
    const r = await base64EncodeAdapter.run('hello', {});
    if (!r.ok) throw new Error('expected ok');
    expect(r.value).toBe('aGVsbG8=');
  });

  it('decodes valid base64', async () => {
    const r = await base64DecodeAdapter.run('aGVsbG8=', {});
    if (!r.ok) throw new Error('expected ok');
    expect(r.value).toBe('hello');
  });

  it('encode→decode round-trips a multi-byte UTF-8 string', async () => {
    const encoded = await base64EncodeAdapter.run('世界 🚀', {});
    if (!encoded.ok) throw new Error('encode failed');
    const decoded = await base64DecodeAdapter.run(encoded.value, {});
    if (!decoded.ok) throw new Error('decode failed');
    expect(decoded.value).toBe('世界 🚀');
  });

  it('decode rejects invalid base64', async () => {
    const r = await base64DecodeAdapter.run('not-base64-😀', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });

  it('decode of empty/whitespace returns empty string', async () => {
    const r = await base64DecodeAdapter.run('   ', {});
    if (!r.ok) throw new Error('expected ok');
    expect(r.value).toBe('');
  });
});

describe('urlParseAdapter', () => {
  it('parses a full URL into structured components', async () => {
    const r = await urlParseAdapter.run('https://api.example.com:8080/users?id=42&id=43#top', {});
    if (!r.ok) throw new Error('expected ok');
    const parsed = JSON.parse(r.value) as Record<string, unknown>;
    expect(parsed.protocol).toBe('https:');
    expect(parsed.host).toBe('api.example.com:8080');
    expect(parsed.pathname).toBe('/users');
    expect(parsed.searchParams).toEqual({ id: ['42', '43'] });
  });

  it('rejects non-absolute input', async () => {
    const r = await urlParseAdapter.run('/relative/path', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });
});

describe('regexReplaceAdapter', () => {
  it('runs a global replacement', async () => {
    const r = await regexReplaceAdapter.run('foo bar foo', {
      pattern: 'foo',
      flags: 'g',
      replacement: 'BAZ',
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value).toBe('BAZ bar BAZ');
  });

  it('rejects invalid pattern', async () => {
    const r = await regexReplaceAdapter.run('foo', {
      pattern: '(',
      flags: '',
      replacement: '',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-options');
  });

  it('returns input unchanged when pattern is empty', async () => {
    const r = await regexReplaceAdapter.run('foo', {
      pattern: '',
      flags: 'g',
      replacement: 'X',
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value).toBe('foo');
  });
});

describe('diffTextAdapter', () => {
  it('produces a unified diff', async () => {
    const r = await diffTextAdapter.run('line2', {
      baseline: 'line1',
      mode: 'unified',
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value).toContain('- line1');
    expect(r.value).toContain('+ line2');
  });

  it('produces JSON entries', async () => {
    const r = await diffTextAdapter.run('b', {
      baseline: 'a',
      mode: 'json',
    });
    if (!r.ok) throw new Error('expected ok');
    const entries = JSON.parse(r.value) as Array<{ kind: string; text: string }>;
    expect(entries.find((e) => e.kind === 'remove')?.text).toBe('a');
    expect(entries.find((e) => e.kind === 'add')?.text).toBe('b');
  });

  it('parseOptions rejects unknown mode', () => {
    expect(diffTextAdapter.parseOptions({ baseline: '', mode: 'csv' })).toBeNull();
  });

  it('rejects pathological line counts that would blow the LCS table', async () => {
    // 2 KiB of single-char lines on each side → m=n=2000 → ~4M cells.
    // Exceeds the 1M DIFF_MAX_DP_CELLS cap.
    const pathological = '\n'.repeat(2000);
    const r = await diffTextAdapter.run(pathological, {
      baseline: pathological,
      mode: 'unified',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
    expect(r.detail).toContain('LCS table');
  });
});
