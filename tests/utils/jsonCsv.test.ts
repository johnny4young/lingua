/**
 * internal — Unit tests for the JSON ↔ CSV converter helper. Covers
 * forward + reverse conversions across delimiters, RFC 4180 quoting,
 * embedded delimiters / newlines, header-row toggle, validation
 * branches (not-array, nested objects, invalid JSON, unclosed quote,
 * empty, too-large), and the reported `rowCount` / `columnCount`
 * metadata.
 */

import { describe, expect, it } from 'vitest';
import {
  JSON_CSV_MAX_BYTES,
  convertCsvToJson,
  convertJsonToCsv,
} from '../../src/renderer/utils/jsonCsv';

describe('convertJsonToCsv', () => {
  it('emits a comma-separated CSV with a header row by default', () => {
    const result = convertJsonToCsv(
      '[{"name":"Alice","score":92},{"name":"Bob","score":87}]',
      { delimiter: ',', includeHeader: true }
    );
    expect(result).toMatchObject({
      ok: true,
      output: 'name,score\nAlice,92\nBob,87',
      rowCount: 2,
      columnCount: 2,
    });
  });

  it('omits the header when includeHeader=false', () => {
    const result = convertJsonToCsv('[{"a":1},{"a":2}]', {
      delimiter: ',',
      includeHeader: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toBe('1\n2');
  });

  it('quotes fields containing the delimiter', () => {
    const result = convertJsonToCsv('[{"x":"a,b"}]', {
      delimiter: ',',
      includeHeader: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('"a,b"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    const result = convertJsonToCsv('[{"q":"she said \\"hi\\""}]', {
      delimiter: ',',
      includeHeader: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toBe('"she said ""hi"""');
  });

  it('quotes fields containing newlines', () => {
    const result = convertJsonToCsv('[{"x":"a\\nb"}]', {
      delimiter: ',',
      includeHeader: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toBe('"a\nb"');
  });

  it('honors a tab delimiter (TSV)', () => {
    const result = convertJsonToCsv('[{"a":1,"b":2}]', {
      delimiter: '\t',
      includeHeader: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toBe('a\tb\n1\t2');
  });

  it('emits the union of keys across rows in first-seen order', () => {
    const result = convertJsonToCsv('[{"a":1},{"b":2,"a":3}]', {
      delimiter: ',',
      includeHeader: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toBe('a,b\n1,\n3,2');
  });

  it('rejects a non-array top-level JSON value', () => {
    expect(
      convertJsonToCsv('{"name":"lingua"}', { delimiter: ',', includeHeader: true })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.notArray',
    });
  });

  it('rejects rows that contain nested objects or arrays', () => {
    expect(
      convertJsonToCsv('[{"a":{"x":1}}]', { delimiter: ',', includeHeader: true })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.notFlatObjects',
    });
    expect(
      convertJsonToCsv('[{"a":[1,2]}]', { delimiter: ',', includeHeader: true })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.notFlatObjects',
    });
  });

  it('rejects malformed JSON with the invalidJson error key', () => {
    expect(
      convertJsonToCsv('[bad', { delimiter: ',', includeHeader: true })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.invalidJson',
    });
  });

  it('rejects empty input with the empty error key', () => {
    expect(convertJsonToCsv('', { delimiter: ',', includeHeader: true })).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.empty',
    });
  });

  it('rejects payloads above the byte cap with the tooLarge error key', () => {
    const huge = '[' + '"x",'.repeat(JSON_CSV_MAX_BYTES) + '"end"]';
    expect(convertJsonToCsv(huge, { delimiter: ',', includeHeader: true })).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.tooLarge',
    });
  });
});

describe('convertCsvToJson', () => {
  it('parses a header-row CSV into an array of objects', () => {
    const result = convertCsvToJson('name,score\nAlice,92\nBob,87', {
      delimiter: ',',
      includeHeader: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.output)).toEqual([
      { name: 'Alice', score: '92' },
      { name: 'Bob', score: '87' },
    ]);
    expect(result.rowCount).toBe(2);
    expect(result.columnCount).toBe(2);
  });

  it('parses a header-less CSV into an array of arrays when includeHeader=false', () => {
    const result = convertCsvToJson('1,2\n3,4', { delimiter: ',', includeHeader: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.output)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles quoted fields with embedded commas and newlines', () => {
    const csv = 'name,note\n"Alice","line1\nline2"\nBob,"comma, in field"';
    const result = convertCsvToJson(csv, { delimiter: ',', includeHeader: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.output)).toEqual([
      { name: 'Alice', note: 'line1\nline2' },
      { name: 'Bob', note: 'comma, in field' },
    ]);
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    const csv = 'q\n"she said ""hi"""';
    const result = convertCsvToJson(csv, { delimiter: ',', includeHeader: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.output)).toEqual([{ q: 'she said "hi"' }]);
  });

  it('rejects malformed quotes instead of silently shifting columns', () => {
    expect(
      convertCsvToJson('name,note\nAlice,"hello"tail', {
        delimiter: ',',
        includeHeader: true,
      })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.invalidCsv',
    });
    expect(
      convertCsvToJson('name,note\nAli"ce,hello', {
        delimiter: ',',
        includeHeader: true,
      })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.invalidCsv',
    });
  });

  it('rejects duplicate header names to avoid overwriting cell data', () => {
    expect(
      convertCsvToJson('name,name\nAlice,Bob', {
        delimiter: ',',
        includeHeader: true,
      })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.invalidCsv',
    });
  });

  it('treats CRLF line endings the same as LF', () => {
    const result = convertCsvToJson('a,b\r\n1,2\r\n3,4\r\n', {
      delimiter: ',',
      includeHeader: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.output)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('rejects an unclosed double quote with the invalidCsv error key', () => {
    expect(
      convertCsvToJson('a,b\n"unclosed', { delimiter: ',', includeHeader: true })
    ).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.invalidCsv',
    });
  });

  it('rejects empty input with the empty error key', () => {
    expect(convertCsvToJson('', { delimiter: ',', includeHeader: true })).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.empty',
    });
  });

  it('honors a tab delimiter (TSV)', () => {
    const result = convertCsvToJson('a\tb\n1\t2', {
      delimiter: '\t',
      includeHeader: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.output)).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('JSON ↔ CSV round-trip', () => {
  it('JSON → CSV → JSON preserves a flat object array', () => {
    const json = '[{"name":"Alice","score":"92"},{"name":"Bob","score":"87"}]';
    const csv = convertJsonToCsv(json, { delimiter: ',', includeHeader: true });
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    const back = convertCsvToJson(csv.output, { delimiter: ',', includeHeader: true });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(JSON.parse(back.output)).toEqual(JSON.parse(json));
  });
});
