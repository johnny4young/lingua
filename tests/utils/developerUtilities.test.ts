import { describe, expect, it } from 'vitest';
import {
  HASH_FILE_MAX_BYTES,
  analyzeColor,
  analyzeJson,
  analyzeRegex,
  analyzeTimestamp,
  applyRegexReplace,
  computeHash,
  computeLineDiff,
  decodeBase64,
  decodeJwt,
  decodeUrlComponentValue,
  detectsAsAbsoluteUrl,
  detectsAsBackslashEscaped,
  detectsAsBase64,
  detectsAsColor,
  detectsAsCron,
  detectsAsCurl,
  detectsAsDataUri,
  detectsAsEncodedHtmlEntity,
  detectsAsHashable,
  detectsAsHtml,
  detectsAsHtmlEntity,
  detectsAsJson,
  detectsAsJwt,
  detectsAsMarkdown,
  detectsAsNumber,
  detectsAsRegex,
  detectsAsSql,
  detectsAsSvg,
  detectsAsTimestamp,
  detectsAsUrlEncoded,
  detectsAsUuid,
  detectsAsYaml,
  encodeBase64,
  encodeUrlComponentValue,
  hashText,
  inspectTimestampLike,
} from '../../src/renderer/utils/developerUtilities';

describe('developerUtilities', () => {
  it('formats valid JSON and leaves empty input neutral', () => {
    expect(analyzeJson('{"name":"Lingua"}')).toMatchObject({
      formatted: '{\n  "name": "Lingua"\n}',
      minified: '{"name":"Lingua"}',
      errorKey: null,
    });

    expect(analyzeJson('   ')).toMatchObject({
      parsed: null,
      errorKey: null,
    });
  });

  it('reports invalid JSON through an error key', () => {
    expect(analyzeJson('{bad json}').errorKey).toBe('utilities.tool.json.error');
  });

  it('encodes and decodes unicode Base64 text', () => {
    const encoded = encodeBase64('Lingua ñ');
    expect(encoded).toBe('TGluZ3VhIMOx');
    expect(decodeBase64(encoded)).toEqual({
      value: 'Lingua ñ',
      errorKey: null,
    });
  });

  it('tolerates whitespace in pasted Base64 input', () => {
    expect(decodeBase64('TGlu\n  Z3Vh IMOx')).toEqual({
      value: 'Lingua ñ',
      errorKey: null,
    });
  });

  it('encodes and decodes URL components', () => {
    const encoded = encodeUrlComponentValue('name=Lingua & scope=utils');
    expect(encoded).toBe('name%3DLingua%20%26%20scope%3Dutils');
    expect(decodeUrlComponentValue(encoded)).toEqual({
      value: 'name=Lingua & scope=utils',
      errorKey: null,
    });
  });

  it('creates stable hashes for the same input', async () => {
    await expect(hashText('Lingua', 'SHA-256')).resolves.toBe(
      '0fcc9b7d744c5feeeaad15919402773216cba26b703a5ad3e0724c2ab2d315ee'
    );
  });

  it('computeHash MD5 matches the known vector for "abc"', async () => {
    const result = await computeHash('abc', { algorithm: 'MD5', mode: 'plain' });
    expect(result).toMatchObject({
      ok: true,
      hex: '900150983cd24fb0d6963f7d28e17f72',
      algorithm: 'MD5',
      mode: 'plain',
      inputByteLength: 3,
    });
  });

  it('computeHash SHA-384 matches the NIST vector for "abc"', async () => {
    const result = await computeHash('abc', { algorithm: 'SHA-384', mode: 'plain' });
    expect(result).toMatchObject({
      ok: true,
      hex: 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
      algorithm: 'SHA-384',
    });
  });

  it('computeHash SHA-512 matches the NIST vector for "abc"', async () => {
    const result = await computeHash('abc', { algorithm: 'SHA-512', mode: 'plain' });
    expect(result).toMatchObject({
      ok: true,
      hex: 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
      algorithm: 'SHA-512',
    });
  });

  it('computeHash HMAC-SHA-256 matches the widely cited quick-brown-fox vector', async () => {
    // The "key" + "The quick brown fox jumps over the lazy dog" combination
    // produces the f7bc83... vector cited in Wikipedia's HMAC article and
    // countless independent verifier tools. Not a formal RFC test-case, but
    // independently cross-referenced enough to serve as a stability anchor.
    const result = await computeHash('The quick brown fox jumps over the lazy dog', {
      algorithm: 'SHA-256',
      mode: 'hmac',
      key: 'key',
    });
    expect(result).toMatchObject({
      ok: true,
      hex: 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
      algorithm: 'SHA-256',
      mode: 'hmac',
    });
  });

  it('computeHash HMAC-SHA-512 produces a 128-char hex digest', async () => {
    const result = await computeHash('abc', {
      algorithm: 'SHA-512',
      mode: 'hmac',
      key: 'secret',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hex).toHaveLength(128);
    expect(result.mode).toBe('hmac');
  });

  it('computeHash rejects HMAC-MD5 with the unsupported-combo error key', async () => {
    const result = await computeHash('abc', {
      algorithm: 'MD5',
      mode: 'hmac',
      key: 'secret',
    });
    expect(result).toEqual({
      ok: false,
      errorKey: 'utilities.tool.hash.error.unsupportedCombo',
    });
  });

  it('computeHash rejects HMAC with an empty key', async () => {
    const result = await computeHash('abc', {
      algorithm: 'SHA-256',
      mode: 'hmac',
      key: '',
    });
    expect(result).toEqual({
      ok: false,
      errorKey: 'utilities.tool.hash.error.emptyKey',
    });
  });

  it('computeHash rejects empty input with the empty error key', async () => {
    const result = await computeHash('', { algorithm: 'SHA-256', mode: 'plain' });
    expect(result).toEqual({
      ok: false,
      errorKey: 'utilities.tool.hash.error.empty',
    });
  });

  it('computeHash rejects payloads above the size limit with the tooLarge error key', async () => {
    // Allocate a buffer 1 byte over the limit; fills with zeros.
    const buffer = new ArrayBuffer(HASH_FILE_MAX_BYTES + 1);
    const result = await computeHash(buffer, { algorithm: 'SHA-256', mode: 'plain' });
    expect(result).toEqual({
      ok: false,
      errorKey: 'utilities.tool.hash.error.fileTooLarge',
    });
  });

  it('computeHash accepts an ArrayBuffer input and hashes the binary bytes', async () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]); // "abc"
    const result = await computeHash(bytes.buffer, {
      algorithm: 'SHA-256',
      mode: 'plain',
    });
    expect(result).toMatchObject({
      ok: true,
      hex: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      inputByteLength: 3,
    });
  });

  it('computeHash round-trips non-ASCII UTF-8 bytes consistently for SHA-256', async () => {
    const textResult = await computeHash('Lingua ñ 🎉', {
      algorithm: 'SHA-256',
      mode: 'plain',
    });
    const bufferResult = await computeHash(
      new TextEncoder().encode('Lingua ñ 🎉').buffer.slice(0),
      { algorithm: 'SHA-256', mode: 'plain' }
    );
    expect(textResult.ok).toBe(true);
    expect(bufferResult.ok).toBe(true);
    if (!textResult.ok || !bufferResult.ok) return;
    expect(textResult.hex).toBe(bufferResult.hex);
  });

  it('decodes JWT header and payload objects', () => {
    expect(
      decodeJwt(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsaW5ndWEiLCJyb2xlIjoiZGV2In0.signature'
      )
    ).toMatchObject({
      header: { alg: 'HS256', typ: 'JWT' },
      payload: { sub: 'lingua', role: 'dev' },
      errorKey: null,
    });
  });

  it('reports malformed JWT structures with stable keys', () => {
    expect(decodeJwt('not-a-jwt').errorKey).toBe('utilities.tool.jwt.errorSegments');
  });

  it('converts unix timestamps into readable representations', () => {
    const analysis = analyzeTimestamp('1713268800');
    expect(analysis.unixSeconds).toBe(1713268800);
    expect(analysis.unixMilliseconds).toBe(1713268800000);
    expect(analysis.iso).toBe('2024-04-16T12:00:00.000Z');
    expect(analysis.utc).toContain('UTC');
    expect(analysis.errorKey).toBeNull();
  });

  it('reports invalid timestamps with a stable key', () => {
    expect(analyzeTimestamp('not-a-date').errorKey).toBe('utilities.tool.timestamp.error');
  });

  it('detects timestamp-like JWT claims without treating small counters as dates', () => {
    const timestamp = inspectTimestampLike(1783624472, 'iat');
    expect(timestamp).toMatchObject({
      unixSeconds: 1783624472,
      unixMilliseconds: 1783624472000,
      iso: new Date(1783624472 * 1000).toISOString(),
    });
    expect(timestamp?.local).toBeTruthy();
    expect(timestamp?.utc).toContain('UTC');
    expect(inspectTimestampLike(31)).toBeNull();
  });

  it('finds all regex matches with capture groups for global patterns', () => {
    const result = analyzeRegex('(\\w+)@(\\w+\\.\\w+)', 'g', 'a@x.io b@y.io');
    expect(result.errorKey).toBeNull();
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.match).toBe('a@x.io');
    expect(result.matches[0]?.groups.map(g => g.value)).toEqual(['a', 'x.io']);
    expect(result.matches[1]?.index).toBe(7);
  });

  it('returns only the first match for non-global regex and empty for no pattern', () => {
    const result = analyzeRegex('foo', '', 'foo bar foo');
    expect(result.matches).toHaveLength(1);

    const empty = analyzeRegex('', '', 'anything');
    expect(empty.matches).toHaveLength(0);
    expect(empty.errorKey).toBeNull();
  });

  it('reports invalid regex patterns via errorKey without throwing', () => {
    expect(analyzeRegex('(unbalanced', 'g', 'x').errorKey).toBe(
      'utilities.tool.regex.errorPattern'
    );
  });

  it('applyRegexReplace replaces every global occurrence and counts them', () => {
    const result = applyRegexReplace('foo', 'g', 'foo bar foo baz foo', 'qux');
    expect(result).toMatchObject({ ok: true, output: 'qux bar qux baz qux', replacementCount: 3 });
  });

  it('applyRegexReplace single-match mode when no global flag', () => {
    const result = applyRegexReplace('foo', '', 'foo bar foo baz', 'qux');
    expect(result).toMatchObject({ ok: true, output: 'qux bar foo baz', replacementCount: 1 });
  });

  it('applyRegexReplace supports numbered back-references ($1, $2)', () => {
    const result = applyRegexReplace(
      '(\\w+)@(\\w+\\.\\w+)',
      'g',
      'hello@lingua.dev and support@example.com',
      '[$1 at $2]'
    );
    expect(result).toMatchObject({
      ok: true,
      output: '[hello at lingua.dev] and [support at example.com]',
      replacementCount: 2,
    });
  });

  it('applyRegexReplace supports named back-references ($<name>)', () => {
    const result = applyRegexReplace(
      '(?<user>\\w+)@(?<host>\\w+\\.\\w+)',
      'g',
      'hello@lingua.dev',
      '$<user> on $<host>'
    );
    expect(result).toMatchObject({
      ok: true,
      output: 'hello on lingua.dev',
      replacementCount: 1,
    });
  });

  it('applyRegexReplace treats $$ as a literal $', () => {
    const result = applyRegexReplace('foo', 'g', 'foo', '$$1');
    // `$$` expands to a literal `$`; `$1` is left untouched because there
    // are no capture groups in the pattern — our expander emits it verbatim.
    expect(result).toMatchObject({ ok: true, output: '$1', replacementCount: 1 });
  });

  it('applyRegexReplace with empty replacement removes matches', () => {
    const result = applyRegexReplace('\\s+', 'g', 'a  b  c', '');
    expect(result).toMatchObject({ ok: true, output: 'abc', replacementCount: 2 });
  });

  it('applyRegexReplace returns the input unchanged when pattern is empty', () => {
    const result = applyRegexReplace('', '', 'any text', 'qux');
    expect(result).toMatchObject({ ok: true, output: 'any text', replacementCount: 0 });
  });

  it('applyRegexReplace returns empty output when input is empty', () => {
    const result = applyRegexReplace('foo', 'g', '', 'bar');
    expect(result).toMatchObject({ ok: true, output: '', replacementCount: 0 });
  });

  it('applyRegexReplace reports invalid pattern via errorKey without throwing', () => {
    const result = applyRegexReplace('(unbalanced', 'g', 'x', 'y');
    expect(result).toMatchObject({ ok: false, errorKey: 'utilities.tool.regex.errorPattern' });
  });

  it('converts colors between hex, rgb, and hsl representations', () => {
    const analysis = analyzeColor('#ff0000');
    expect(analysis.errorKey).toBeNull();
    expect(analysis.hex).toBe('#ff0000');
    expect(analysis.rgb).toEqual({ r: 255, g: 0, b: 0 });
    expect(analysis.hsl?.h).toBe(0);
    expect(analysis.hsl?.s).toBe(100);

    expect(analyzeColor('  #0f0  ').hex).toBe('#00ff00');
    expect(analyzeColor('rgb(0, 0, 255)').hex).toBe('#0000ff');
    expect(analyzeColor('hsl(120, 100%, 50%)').rgb).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('reports invalid colors with a stable error key', () => {
    expect(analyzeColor('not-a-color').errorKey).toBe('utilities.tool.color.error');
    expect(analyzeColor('#abcd').errorKey).toBe('utilities.tool.color.error');
    expect(analyzeColor('rgb(300, 0, 0)').errorKey).toBe('utilities.tool.color.error');
  });

  it('returns an empty color analysis for blank input', () => {
    expect(analyzeColor('   ')).toEqual({
      hex: null,
      rgb: null,
      hsl: null,
      errorKey: null,
    });
  });

  it('computes a line diff with add and remove markers', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nb2\nc\nd');
    expect(diff.lines.map(entry => entry.kind)).toEqual(['same', 'remove', 'add', 'same', 'add']);
    expect(diff.addCount).toBe(2);
    expect(diff.removeCount).toBe(1);
    expect(diff.sameCount).toBe(2);
    expect(diff.truncated).toBe(false);
  });

  it('reports identical inputs as all-same lines', () => {
    const diff = computeLineDiff('same\nlines', 'same\nlines');
    expect(diff.addCount).toBe(0);
    expect(diff.removeCount).toBe(0);
    expect(diff.lines.every(entry => entry.kind === 'same')).toBe(true);
  });

  it('flags diff truncation when inputs exceed the character cap', () => {
    const huge = 'x'.repeat(50_000);
    const diff = computeLineDiff(huge, `${huge}y`);
    expect(diff.truncated).toBe(true);
  });
});

describe('detectsAs* predicates ', () => {
  it('detectsAsJson recognises only structural payloads', () => {
    expect(detectsAsJson('{"a":1}')).toBe(true);
    expect(detectsAsJson('[1,2]')).toBe(true);
    // Valid JSON literal but not a value worth running the formatter on.
    expect(detectsAsJson('"a string"')).toBe(false);
    expect(detectsAsJson('not json at all')).toBe(false);
    expect(detectsAsJson('   ')).toBe(false);
  });

  it('detectsAsBase64 enforces a valid 4-aligned shape', () => {
    expect(detectsAsBase64('TGluZ3Vh')).toBe(true);
    expect(detectsAsBase64('TGluZ3Vh==')).toBe(false);
    expect(detectsAsBase64('!!! not base64')).toBe(false);
    expect(detectsAsBase64('')).toBe(false);
  });

  it('detectsAsUrlEncoded requires at least one percent-escape', () => {
    expect(detectsAsUrlEncoded('hello%20world')).toBe(true);
    expect(detectsAsUrlEncoded('hello world')).toBe(false);
  });

  it('detectsAsAbsoluteUrl validates the URL constructor', () => {
    expect(detectsAsAbsoluteUrl('https://lingua.dev/path?x=1')).toBe(true);
    expect(detectsAsAbsoluteUrl('/relative/path')).toBe(false);
    expect(detectsAsAbsoluteUrl('not a url')).toBe(false);
  });

  it('detectsAsJwt matches the canonical three-segment shape', () => {
    expect(detectsAsJwt('aaa.bbb.ccc')).toBe(true);
    expect(detectsAsJwt('aaa.bbb')).toBe(false);
    expect(detectsAsJwt('not a jwt')).toBe(false);
  });

  it('detectsAsUuid matches the canonical 8-4-4-4-12 form', () => {
    expect(detectsAsUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(detectsAsUuid('not-a-uuid')).toBe(false);
  });

  it('detectsAsTimestamp accepts epoch seconds and ISO strings', () => {
    expect(detectsAsTimestamp('1700000000')).toBe(true);
    expect(detectsAsTimestamp('2024-01-15T10:00:00Z')).toBe(true);
    expect(detectsAsTimestamp('not a date')).toBe(false);
  });

  it('detectsAsRegex compiles the pattern via RegExp', () => {
    expect(detectsAsRegex('(\\d+)')).toBe(true);
    expect(detectsAsRegex('(unclosed')).toBe(false);
    expect(detectsAsRegex('')).toBe(false);
  });

  it('detectsAsColor accepts hex / rgb / hsl', () => {
    expect(detectsAsColor('#4f46e5')).toBe(true);
    expect(detectsAsColor('rgb(79, 70, 229)')).toBe(true);
    expect(detectsAsColor('hsl(245, 75%, 58%)')).toBe(true);
    expect(detectsAsColor('not a color')).toBe(false);
  });

  it('detectsAsNumber accepts decimal, hex, octal, binary literals', () => {
    expect(detectsAsNumber('255')).toBe(true);
    expect(detectsAsNumber('0xff')).toBe(true);
    expect(detectsAsNumber('0b1010')).toBe(true);
    expect(detectsAsNumber('1_000')).toBe(true);
    expect(detectsAsNumber('abc')).toBe(false);
    expect(detectsAsNumber('0b102')).toBe(false);
    expect(detectsAsNumber('0o9')).toBe(false);
    expect(detectsAsNumber('not a number')).toBe(false);
  });

  it('detectsAsHtml fires on tag-shaped input', () => {
    expect(detectsAsHtml('<div>hello</div>')).toBe(true);
    expect(detectsAsHtml('plain text')).toBe(false);
  });

  it('detectsAsHtmlEntity distinguishes encoded entities from raw HTML', () => {
    expect(detectsAsHtmlEntity('&lt;p&gt;hello&lt;/p&gt;')).toBe(true);
    expect(detectsAsHtmlEntity('<p>hello</p>')).toBe(true);
    expect(detectsAsEncodedHtmlEntity('&lt;p&gt;hello&lt;/p&gt;')).toBe(true);
    expect(detectsAsEncodedHtmlEntity('<p>hello</p>')).toBe(false);
  });

  it('detectsAsSvg fires only on <svg> roots', () => {
    expect(detectsAsSvg('<svg viewBox="0 0 24 24"></svg>')).toBe(true);
    expect(detectsAsSvg('<div></div>')).toBe(false);
  });

  it('detectsAsDataUri requires a data URI prefix', () => {
    expect(detectsAsDataUri('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(detectsAsDataUri('iVBORw0KGgo=')).toBe(false);
  });

  it('detectsAsBackslashEscaped requires an escape sequence', () => {
    expect(detectsAsBackslashEscaped('hello\\nworld')).toBe(true);
    expect(detectsAsBackslashEscaped('plain')).toBe(false);
  });

  it('detectsAsCron matches both classic and macro forms', () => {
    expect(detectsAsCron('*/5 * * * *')).toBe(true);
    expect(detectsAsCron('@hourly')).toBe(true);
    expect(detectsAsCron('not cron')).toBe(false);
  });

  it('detectsAsCurl requires the leading curl token', () => {
    expect(detectsAsCurl('curl https://example.com')).toBe(true);
    expect(detectsAsCurl('https://example.com')).toBe(false);
  });

  it('detectsAsMarkdown notices headings, lists, and code fences', () => {
    expect(detectsAsMarkdown('# Title')).toBe(true);
    expect(detectsAsMarkdown('- bullet')).toBe(true);
    expect(detectsAsMarkdown('plain prose')).toBe(false);
  });

  it('detectsAsYaml biases toward indented mappings', () => {
    expect(detectsAsYaml('name: lingua')).toBe(true);
    expect(detectsAsYaml('{"name": "lingua"}')).toBe(false);
  });

  it('detectsAsSql fires on common verbs', () => {
    expect(detectsAsSql('SELECT * FROM users')).toBe(true);
    expect(detectsAsSql('select id from t')).toBe(true);
    expect(detectsAsSql('not sql')).toBe(false);
  });

  it('detectsAsHashable accepts any non-empty input', () => {
    expect(detectsAsHashable('Lingua')).toBe(true);
    expect(detectsAsHashable('a')).toBe(true);
    expect(detectsAsHashable('   ')).toBe(false);
    expect(detectsAsHashable('')).toBe(false);
  });
});
