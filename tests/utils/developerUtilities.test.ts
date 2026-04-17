import { describe, expect, it } from 'vitest';
import {
  analyzeJson,
  analyzeTimestamp,
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
});
