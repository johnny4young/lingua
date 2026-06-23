/**
 * RL-099 Slice 1 — utility adapter unit tests.
 *
 * Covers the shared utility adapter registry — happy path + reject path
 * + parseOptions shape guard. Keeps the test surface single-file since
 * each adapter is small.
 */

import { describe, expect, it } from 'vitest';
import { base64DecodeAdapter, base64EncodeAdapter } from '../../../src/shared/utilities/base64';
import { diffTextAdapter } from '../../../src/shared/utilities/diffText';
import { jsonFormatAdapter } from '../../../src/shared/utilities/jsonFormat';
import { regexReplaceAdapter } from '../../../src/shared/utilities/regexReplace';
import { urlParseAdapter } from '../../../src/shared/utilities/urlParse';
import { hashAdapter } from '../../../src/shared/utilities/hash';
import { jwtDecodeAdapter } from '../../../src/shared/utilities/jwtDecode';
import {
  urlDecodeAdapter,
  urlEncodeAdapter,
} from '../../../src/shared/utilities/urlComponent';
import { timestampAdapter } from '../../../src/shared/utilities/timestamp';
import { colorConvertAdapter } from '../../../src/shared/utilities/colorConvert';
import { stringCaseAdapter } from '../../../src/shared/utilities/stringCase';
import {
  htmlEntityDecodeAdapter,
  htmlEntityEncodeAdapter,
} from '../../../src/shared/utilities/htmlEntity';
import { numberBaseAdapter } from '../../../src/shared/utilities/numberBase';
import { lineSortAdapter } from '../../../src/shared/utilities/lineSort';
import { slugifyAdapter } from '../../../src/shared/utilities/slugify';
import { jsonMinifyAdapter } from '../../../src/shared/utilities/jsonMinify';
import { textStatsAdapter } from '../../../src/shared/utilities/textStats';
import {
  UTILITY_ADAPTER_REGISTRY,
  listAdapters,
} from '../../../src/shared/utilities/registry';
import { UTILITY_ADAPTER_IDS } from '../../../src/shared/utilities/types';
import enCommon from '../../../src/renderer/i18n/locales/en/common.json';
import esCommon from '../../../src/renderer/i18n/locales/es/common.json';

describe('UTILITY_ADAPTER_REGISTRY', () => {
  it('exposes all 20 closed-enum adapters', () => {
    expect(Object.keys(UTILITY_ADAPTER_REGISTRY).sort()).toEqual([
      'base64-decode',
      'base64-encode',
      'color-convert',
      'diff-text',
      'hash',
      'html-entity-decode',
      'html-entity-encode',
      'json-format',
      'json-minify',
      'jwt-decode',
      'line-sort',
      'number-base',
      'regex-replace',
      'slugify',
      'string-case',
      'text-stats',
      'timestamp',
      'url-decode',
      'url-encode',
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

// ---------------------------------------------------------------------------
// RL-099 Slice 4 — vocabulary expansion adapters.
// ---------------------------------------------------------------------------

describe('hashAdapter', () => {
  it('hashes with the default SHA-256 algorithm (known vector)', async () => {
    const r = await hashAdapter.run('abc', { algorithm: 'SHA-256' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Well-known SHA-256("abc").
    expect(r.value).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('honours the algorithm select', async () => {
    const r = await hashAdapter.run('abc', { algorithm: 'SHA-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('parseOptions defaults a missing algorithm and rejects an unknown one', () => {
    expect(hashAdapter.parseOptions(undefined)).toEqual({ algorithm: 'SHA-256' });
    expect(hashAdapter.parseOptions({})).toEqual({ algorithm: 'SHA-256' });
    expect(hashAdapter.parseOptions({ algorithm: 'MD5' })).toBeNull();
    expect(hashAdapter.parseOptions({ algorithm: 'SHA-512' })).toEqual({
      algorithm: 'SHA-512',
    });
  });
});

describe('jwtDecodeAdapter', () => {
  // header {"alg":"HS256","typ":"JWT"} . payload {"sub":"42","name":"Ada"} . sig
  const token =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsIm5hbWUiOiJBZGEifQ.sig';

  it('decodes header + payload without verifying the signature', async () => {
    const r = await jwtDecodeAdapter.run(token, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.value) as {
      header: Record<string, unknown>;
      payload: Record<string, unknown>;
    };
    expect(parsed.header.alg).toBe('HS256');
    expect(parsed.payload.name).toBe('Ada');
  });

  it('rejects a non-JWT string without throwing', async () => {
    const r = await jwtDecodeAdapter.run('not-a-token', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });

  it('rejects a token whose payload is not valid base64url JSON', async () => {
    const r = await jwtDecodeAdapter.run('aGVhZGVy.@@@.sig', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });
});

describe('url component adapters', () => {
  it('encodes and round-trips a component', async () => {
    const enc = await urlEncodeAdapter.run('a b&c=ñ', {});
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    expect(enc.value).toBe('a%20b%26c%3D%C3%B1');
    const dec = await urlDecodeAdapter.run(enc.value, {});
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.value).toBe('a b&c=ñ');
  });

  it('rejects a malformed percent-sequence on decode', async () => {
    const r = await urlDecodeAdapter.run('%E0%A4%A', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });

  it('settles (never throws) on a lone surrogate during encode', async () => {
    const r = await urlEncodeAdapter.run('\uD800', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });
});

describe('timestampAdapter', () => {
  it('parses epoch milliseconds', async () => {
    const r = await timestampAdapter.run('1700000000000', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain('ISO 8601: 2023-11-14T22:13:20.000Z');
    expect(r.value).toContain('Epoch s:  1700000000');
  });

  it('parses epoch seconds (<= 11 digits)', async () => {
    const r = await timestampAdapter.run('1700000000', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain('Epoch ms: 1700000000000');
  });

  it('parses an ISO date string', async () => {
    const r = await timestampAdapter.run('2023-11-14T22:13:20Z', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain('Epoch ms: 1700000000000');
  });

  it('rejects an unparseable value', async () => {
    const r = await timestampAdapter.run('not a date', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });
});

describe('colorConvertAdapter', () => {
  it('converts a 6-digit hex to rgb + hsl', async () => {
    const r = await colorConvertAdapter.run('#ff0000', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain('HEX: #ff0000');
    expect(r.value).toContain('RGB: rgb(255, 0, 0)');
    expect(r.value).toContain('HSL: hsl(0, 100%, 50%)');
  });

  it('expands a 3-digit hex and keeps alpha', async () => {
    const r = await colorConvertAdapter.run('#0f08', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain('rgba(0, 255, 0, 0.533)');
  });

  it('parses rgb() notation', async () => {
    const r = await colorConvertAdapter.run('rgb(0, 0, 255)', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain('HSL: hsl(240, 100%, 50%)');
  });

  it('rejects an unparseable color', async () => {
    const r = await colorConvertAdapter.run('rebeccapurple', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });

  it('rejects malformed or out-of-range alpha channels', async () => {
    for (const input of [
      'rgba(1, 2, 3,)',
      'rgba(1, 2, 3, 1.5)',
      'rgb(1, 2, 3, 0.5)',
    ]) {
      const r = await colorConvertAdapter.run(input, {});
      expect(r.ok, input).toBe(false);
      if (r.ok) continue;
      expect(r.reason, input).toBe('invalid-input');
    }
  });
});

describe('stringCaseAdapter', () => {
  it('converts a mixed phrase to camelCase (default)', async () => {
    const r = await stringCaseAdapter.run('hello world-foo_bar', {
      target: 'camel',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe('helloWorldFooBar');
  });

  it('tokenizes camelCase + acronyms before recasing to snake', async () => {
    const r = await stringCaseAdapter.run('parseJSONData', { target: 'snake' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe('parse_json_data');
  });

  it('supports upper / title / kebab', async () => {
    const upper = await stringCaseAdapter.run('a b', { target: 'upper' });
    const title = await stringCaseAdapter.run('a b', { target: 'title' });
    const kebab = await stringCaseAdapter.run('a B', { target: 'kebab' });
    expect(upper.ok && upper.value).toBe('A B');
    expect(title.ok && title.value).toBe('A B');
    expect(kebab.ok && kebab.value).toBe('a-b');
  });

  it('parseOptions rejects an unknown target', () => {
    expect(stringCaseAdapter.parseOptions({ target: 'pascal' })).toBeNull();
    expect(stringCaseAdapter.parseOptions(undefined)).toEqual({ target: 'camel' });
  });
});

describe('html entity adapters', () => {
  it('encodes the five HTML special characters', async () => {
    const r = await htmlEntityEncodeAdapter.run(`<a href="x">'&'</a>`, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    );
  });

  it('decodes named and numeric entities', async () => {
    const r = await htmlEntityDecodeAdapter.run(
      '&lt;b&gt;caf&#233;&#x20;&amp; co&lt;/b&gt;',
      {}
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe('<b>café & co</b>');
  });

  it('round-trips the encodable set', async () => {
    const original = `5 < 6 & "ok"`;
    const enc = await htmlEntityEncodeAdapter.run(original, {});
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    const dec = await htmlEntityDecodeAdapter.run(enc.value, {});
    expect(dec.ok && dec.value).toBe(original);
  });

  it('leaves malformed numeric entities unchanged', async () => {
    const r = await htmlEntityDecodeAdapter.run('bad: &#12abc; &#xzz;', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe('bad: &#12abc; &#xzz;');
  });
});

// RL-099 Slice 6 — vocabulary expansion round 2.
describe('numberBaseAdapter (RL-099 Slice 6)', () => {
  it('auto-detects a hex literal and converts to decimal', async () => {
    const r = await numberBaseAdapter.run('0xFF', {
      from: 'auto',
      to: '10',
      prefixOutput: false,
    });
    expect(r.ok && r.value).toBe('255');
  });

  it('converts decimal to binary with the 0b prefix (fold G)', async () => {
    const r = await numberBaseAdapter.run('10', {
      from: '10',
      to: '2',
      prefixOutput: true,
    });
    expect(r.ok && r.value).toBe('0b1010');
  });

  it('handles negative values and large integers (BigInt, no precision loss)', async () => {
    const big = '123456789012345678901234567890';
    const r = await numberBaseAdapter.run(`-${big}`, {
      from: '10',
      to: '16',
      prefixOutput: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(`-${BigInt(big).toString(16)}`);
  });

  it('rejects a digit out of range for the source base', async () => {
    const r = await numberBaseAdapter.run('9', {
      from: '2',
      to: '10',
      prefixOutput: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });

  it('rejects empty input', async () => {
    const r = await numberBaseAdapter.run('   ', {
      from: 'auto',
      to: '10',
      prefixOutput: false,
    });
    expect(r.ok).toBe(false);
  });

  it('parseOptions rejects an unknown base', () => {
    expect(numberBaseAdapter.parseOptions({ from: '3', to: '10' })).toBeNull();
    expect(numberBaseAdapter.parseOptions(undefined)).toEqual({
      from: 'auto',
      to: '10',
      prefixOutput: false,
    });
  });
});

describe('lineSortAdapter (RL-099 Slice 6)', () => {
  it('sorts ascending by codepoint and preserves a trailing newline', async () => {
    const r = await lineSortAdapter.run('banana\napple\ncherry\n', {
      direction: 'asc',
      caseInsensitive: false,
      unique: false,
      numeric: false,
    });
    expect(r.ok && r.value).toBe('apple\nbanana\ncherry\n');
  });

  it('drops duplicates with the unique option', async () => {
    const r = await lineSortAdapter.run('b\na\nb\na', {
      direction: 'asc',
      caseInsensitive: false,
      unique: true,
      numeric: false,
    });
    expect(r.ok && r.value).toBe('a\nb');
  });

  it('sorts numerically (natural order) when enabled (fold D)', async () => {
    const r = await lineSortAdapter.run('item10\nitem2\nitem1', {
      direction: 'asc',
      caseInsensitive: false,
      unique: false,
      numeric: true,
    });
    expect(r.ok && r.value).toBe('item1\nitem2\nitem10');
  });

  it('normalizes CRLF and legacy CR line endings before sorting', async () => {
    const r = await lineSortAdapter.run('delta\r\nalpha\rcharlie', {
      direction: 'asc',
      caseInsensitive: false,
      unique: false,
      numeric: false,
    });
    expect(r.ok && r.value).toBe('alpha\ncharlie\ndelta');
  });

  it('case-insensitive descending order', async () => {
    const r = await lineSortAdapter.run('b\nA\nc', {
      direction: 'desc',
      caseInsensitive: true,
      unique: false,
      numeric: false,
    });
    expect(r.ok && r.value).toBe('c\nb\nA');
  });

  it('parseOptions rejects invalid direction and boolean shapes', () => {
    expect(lineSortAdapter.parseOptions({ direction: 'sideways' })).toBeNull();
    expect(lineSortAdapter.parseOptions({ unique: 'true' })).toBeNull();
    expect(lineSortAdapter.parseOptions(undefined)).toEqual({
      direction: 'asc',
      caseInsensitive: false,
      unique: false,
      numeric: false,
    });
  });
});

describe('slugifyAdapter (RL-099 Slice 6)', () => {
  it('slugifies with accent folding and lowercasing', async () => {
    const r = await slugifyAdapter.run('  Crème Brûlée! ', {
      separator: 'hyphen',
      lowercase: true,
    });
    expect(r.ok && r.value).toBe('creme-brulee');
  });

  it('honours the underscore separator and case preservation', async () => {
    const r = await slugifyAdapter.run('Hello World', {
      separator: 'underscore',
      lowercase: false,
    });
    expect(r.ok && r.value).toBe('Hello_World');
  });

  it('collapses all-symbol input to an empty slug (no failure)', async () => {
    const r = await slugifyAdapter.run('@@@ ###', {
      separator: 'hyphen',
      lowercase: true,
    });
    expect(r.ok && r.value).toBe('');
  });

  it('parseOptions rejects invalid separator and boolean shapes', () => {
    expect(slugifyAdapter.parseOptions({ separator: 'space' })).toBeNull();
    expect(slugifyAdapter.parseOptions({ lowercase: 'true' })).toBeNull();
    expect(slugifyAdapter.parseOptions(undefined)).toEqual({
      separator: 'hyphen',
      lowercase: true,
    });
  });
});

describe('jsonMinifyAdapter (RL-099 Slice 6 fold B)', () => {
  it('minifies valid JSON', async () => {
    const r = await jsonMinifyAdapter.run('{\n  "a": 1,\n  "b": [2, 3]\n}', {});
    expect(r.ok && r.value).toBe('{"a":1,"b":[2,3]}');
  });

  it('rejects malformed JSON with invalid-input', async () => {
    const r = await jsonMinifyAdapter.run('{ not json', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-input');
  });

  it('parseOptions rejects non-object option blobs', () => {
    expect(jsonMinifyAdapter.parseOptions(['unexpected'])).toBeNull();
    expect(jsonMinifyAdapter.parseOptions('unexpected')).toBeNull();
    expect(jsonMinifyAdapter.parseOptions(undefined)).toEqual({});
  });
});

describe('textStatsAdapter (RL-099 Slice 6 fold C)', () => {
  it('counts lines, words, characters, and bytes', async () => {
    const r = await textStatsAdapter.run('hello world\nsecond line', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe('Lines: 2\nWords: 4\nCharacters: 23\nBytes: 23');
  });

  it('reports zeros for empty input', async () => {
    const r = await textStatsAdapter.run('', {});
    expect(r.ok && r.value).toBe('Lines: 0\nWords: 0\nCharacters: 0\nBytes: 0');
  });

  it('counts multi-byte characters by code point and UTF-8 bytes', async () => {
    const r = await textStatsAdapter.run('café', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 4 code points, 5 UTF-8 bytes (é = 2 bytes).
    expect(r.value).toBe('Lines: 1\nWords: 1\nCharacters: 4\nBytes: 5');
  });

  it('parseOptions rejects non-object option blobs', () => {
    expect(textStatsAdapter.parseOptions(['unexpected'])).toBeNull();
    expect(textStatsAdapter.parseOptions('unexpected')).toBeNull();
    expect(textStatsAdapter.parseOptions(undefined)).toEqual({});
  });
});

// Fold D — registry + i18n completeness guard. Every closed-enum id must
// have a registry adapter AND title/description keys in BOTH locales.
describe('adapter registry completeness (RL-099 Slice 4 fold D)', () => {
  const en = enCommon as Record<string, string>;
  const es = esCommon as Record<string, string>;

  function camelKey(id: string): string {
    return id.replace(/-([a-z])/gu, (_m, c: string) => c.toUpperCase());
  }

  it('lists exactly the closed-enum ids', () => {
    expect(listAdapters().map((a) => a.id).sort()).toEqual(
      [...UTILITY_ADAPTER_IDS].sort()
    );
  });

  it('every id resolves to an adapter whose own id matches', () => {
    for (const id of UTILITY_ADAPTER_IDS) {
      expect(UTILITY_ADAPTER_REGISTRY[id]?.id).toBe(id);
    }
  });

  it('every adapter has title + description keys in both locales', () => {
    for (const adapter of listAdapters()) {
      const base = `utilityPipeline.adapter.${camelKey(adapter.id)}`;
      expect(en[`${base}.title`], `${base}.title (en)`).toBeTruthy();
      expect(en[`${base}.description`], `${base}.description (en)`).toBeTruthy();
      expect(es[`${base}.title`], `${base}.title (es)`).toBeTruthy();
      expect(es[`${base}.description`], `${base}.description (es)`).toBeTruthy();
    }
  });

  it('every adapter select-option label resolves in both locales', () => {
    for (const adapter of listAdapters()) {
      for (const field of adapter.optionsSchema) {
        expect(en[field.labelKey], `${field.labelKey} (en)`).toBeTruthy();
        expect(es[field.labelKey], `${field.labelKey} (es)`).toBeTruthy();
        if (field.type === 'select') {
          for (const option of field.options) {
            expect(en[option.labelKey], `${option.labelKey} (en)`).toBeTruthy();
            expect(es[option.labelKey], `${option.labelKey} (es)`).toBeTruthy();
          }
        }
      }
    }
  });
});
