/**
 * RL-068 — Unit tests for the YAML ↔ JSON converter helper. Covers
 * round-trips for both directions, comment-detection edge cases,
 * indent options, multi-doc rejection, and the empty / invalid
 * branches.
 */

import { describe, expect, it } from 'vitest';
import {
  convertJsonToYaml,
  convertYamlToJson,
} from '../../src/renderer/utils/yamlJson';

describe('convertYamlToJson', () => {
  it('converts a simple YAML mapping to indented JSON', () => {
    const result = convertYamlToJson('name: lingua\nversion: 0.2.1', { indent: 2 });
    expect(result).toMatchObject({
      ok: true,
      output: '{\n  "name": "lingua",\n  "version": "0.2.1"\n}',
      hadComments: false,
    });
  });

  it('honors the 4-space indent option', () => {
    const result = convertYamlToJson('a:\n  b: 1', { indent: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // First level indents 4 spaces; nested key indents 8.
    expect(result.output).toContain('\n    "a"');
    expect(result.output).toContain('\n        "b": 1');
  });

  it('detects comments at the start of a line', () => {
    const result = convertYamlToJson('# leading comment\nname: lingua', { indent: 2 });
    expect(result).toMatchObject({ ok: true, hadComments: true });
  });

  it('detects trailing comments on a value line', () => {
    const result = convertYamlToJson('name: lingua # trailing', { indent: 2 });
    expect(result).toMatchObject({ ok: true, hadComments: true });
  });

  it('does not treat # inside double-quoted scalars as a comment', () => {
    const result = convertYamlToJson('name: "has # hash"', { indent: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hadComments).toBe(false);
    expect(result.output).toContain('"has # hash"');
  });

  it('does not treat # inside single-quoted scalars as a comment', () => {
    const result = convertYamlToJson("name: 'has # hash'", { indent: 2 });
    expect(result).toMatchObject({ ok: true, hadComments: false });
  });

  it("does not toggle out of a single-quoted scalar on the YAML '' apostrophe escape", () => {
    const result = convertYamlToJson("name: 'it''s a # hash'", { indent: 2 });
    expect(result).toMatchObject({ ok: true, hadComments: false });
    if (!result.ok) return;
    expect(JSON.parse(result.output)).toEqual({ name: "it's a # hash" });
  });

  it('rejects multi-document YAML with the invalidYaml error key', () => {
    const result = convertYamlToJson('---\na: 1\n---\nb: 2', { indent: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKey).toBe('utilities.tool.yamlJson.error.invalidYaml');
    expect(result.message).toBeTruthy();
  });

  it('rejects malformed YAML with the invalidYaml error key', () => {
    const result = convertYamlToJson('a: : :', { indent: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKey).toBe('utilities.tool.yamlJson.error.invalidYaml');
  });

  it('rejects empty input with the empty error key', () => {
    expect(convertYamlToJson('', { indent: 2 })).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.yamlJson.error.empty',
    });
    expect(convertYamlToJson('   \n   ', { indent: 2 })).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.yamlJson.error.empty',
    });
  });

  it('handles arrays and nested objects', () => {
    const result = convertYamlToJson(
      'services:\n  - editor\n  - runner\nmeta:\n  ok: true',
      { indent: 2 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.output)).toEqual({
      services: ['editor', 'runner'],
      meta: { ok: true },
    });
  });
});

describe('convertJsonToYaml', () => {
  it('converts a JSON object to YAML', () => {
    const result = convertJsonToYaml('{"name":"lingua","version":"0.2.1"}', { indent: 2 });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.output).toContain('name: lingua');
    expect(result.output).toContain("version: 0.2.1");
  });

  it('rejects malformed JSON with the invalidJson error key', () => {
    const result = convertJsonToYaml('{bad json}', { indent: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKey).toBe('utilities.tool.yamlJson.error.invalidJson');
    expect(result.message).toBeTruthy();
  });

  it('rejects empty input with the empty error key', () => {
    expect(convertJsonToYaml('', { indent: 2 })).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.yamlJson.error.empty',
    });
  });

  it('uses the requested indent in nested structures', () => {
    const result = convertJsonToYaml('{"a":{"b":{"c":1}}}', { indent: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('\n    b:');
    expect(result.output).toContain('\n        c: 1');
  });

  it('does not append a trailing newline to the output', () => {
    const result = convertJsonToYaml('{"a":1}', { indent: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.endsWith('\n')).toBe(false);
  });
});

describe('YAML ↔ JSON round-trip', () => {
  it('JSON → YAML → JSON preserves structure for the seeded sample', () => {
    const json = '{"name":"lingua","services":["a","b"],"flag":true}';
    const yaml = convertJsonToYaml(json, { indent: 2 });
    expect(yaml.ok).toBe(true);
    if (!yaml.ok) return;
    const back = convertYamlToJson(yaml.output, { indent: 2 });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(JSON.parse(back.output)).toEqual(JSON.parse(json));
  });
});
