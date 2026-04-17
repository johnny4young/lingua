import { describe, expect, it } from 'vitest';
import {
  analyzeColor,
  analyzeJson,
  analyzeRegex,
  analyzeTimestamp,
  computeLineDiff,
  decodeBase64,
  decodeJwt,
  decodeUrlComponentValue,
  encodeBase64,
  encodeUrlComponentValue,
  hashText,
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
    expect(analysis.errorKey).toBeNull();
  });

  it('reports invalid timestamps with a stable key', () => {
    expect(analyzeTimestamp('not-a-date').errorKey).toBe(
      'utilities.tool.timestamp.error'
    );
  });

  it('finds all regex matches with capture groups for global patterns', () => {
    const result = analyzeRegex('(\\w+)@(\\w+\\.\\w+)', 'g', 'a@x.io b@y.io');
    expect(result.errorKey).toBeNull();
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.match).toBe('a@x.io');
    expect(result.matches[0]?.groups.map((g) => g.value)).toEqual(['a', 'x.io']);
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
    expect(diff.lines.map((entry) => entry.kind)).toEqual([
      'same',
      'remove',
      'add',
      'same',
      'add',
    ]);
    expect(diff.addCount).toBe(2);
    expect(diff.removeCount).toBe(1);
    expect(diff.sameCount).toBe(2);
    expect(diff.truncated).toBe(false);
  });

  it('reports identical inputs as all-same lines', () => {
    const diff = computeLineDiff('same\nlines', 'same\nlines');
    expect(diff.addCount).toBe(0);
    expect(diff.removeCount).toBe(0);
    expect(diff.lines.every((entry) => entry.kind === 'same')).toBe(true);
  });

  it('flags diff truncation when inputs exceed the character cap', () => {
    const huge = 'x'.repeat(50_000);
    const diff = computeLineDiff(huge, `${huge}y`);
    expect(diff.truncated).toBe(true);
  });
});
