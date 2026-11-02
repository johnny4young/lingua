import { describe, expect, it } from 'vitest';
import { extractTimeoutMagicComment, originSuppressedByMagicComment } from '../../src/renderer/utils/magicComments/directives';
import { getAdapter } from '../../src/shared/utilities/registry';
import { UTILITY_ADAPTER_IDS, type UtilityAdapterId } from '../../src/shared/utilities/types';
import type { PipelineStepV1 } from '../../src/shared/utilityPipeline';
import { buildPipelineJs } from '../../src/shared/utilityPipelineJs';
import { PIPELINE_TEMPLATES } from '../../src/shared/utilityPipelineTemplates';

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<void>;

const LABELS = {
  input: 'Put your input here; the snippet never keeps it.',
  title: (id: UtilityAdapterId) => id,
  skipped: (title: string) => `${title} has no short JS form.`,
};

const step = (utilityId: UtilityAdapterId, options?: unknown, index = 0): PipelineStepV1 =>
  ({ id: `s${index}`, utilityId, options: options ?? getAdapter(utilityId)!.defaultOptions() }) as PipelineStepV1;

async function runSnippet(code: string, input: string): Promise<string[]> {
  expect(code).toContain('let value = "";');
  const seeded = code.replace('let value = "";', () => `let value = ${JSON.stringify(input)};`);
  const logged: string[] = [];
  await new AsyncFunction('console', seeded)({ log: (text: string) => logged.push(text) });
  return logged;
}

async function runAdapters(steps: PipelineStepV1[], input: string) {
  let value = input;
  for (const current of steps) {
    const adapter = getAdapter(current.utilityId)!;
    const outcome = await adapter.run(value, adapter.parseOptions(current.options) ?? adapter.defaultOptions());
    if (!outcome.ok) return null;
    value = outcome.value;
  }
  return value;
}

async function expectSame(steps: PipelineStepV1[], input: string) {
  const expected = await runAdapters(steps, input);
  const code = buildPipelineJs(steps, LABELS);
  if (expected === null) {
    await expect(runSnippet(code, input), `${input} should fail`).rejects.toThrow();
    return;
  }
  expect(await runSnippet(code, input), input).toEqual([expected]);
}

const TEXT = ['', ' ', 'hello world', 'Ñandú café ☕ 𝒳', 'line one\nline two\r\nline three\rfour\n', '<a href="x">&amp;\'</a>', 'a+b c/d?e=f&g=h%20'];

const CASES: ReadonlyArray<[UtilityAdapterId, ReadonlyArray<Record<string, unknown>>, readonly string[]]> = [
  ['json-format', [{ indent: 'minified' }, { indent: '2' }, { indent: '4' }, { indent: 2 }, { indent: 4 }], ['', '  ', '{"a":[1,{"b":null}],"ñ":"☕"}', '[1, 2]', 'null', '{bad', '1e3', '"\\u00e9"']],
  ['json-minify', [{}], ['', ' ', '{ "a" : [ 1 , 2 ] }', '{bad', ' 12 ']],
  ['base64-encode', [{}], TEXT],
  ['base64-decode', [{}], ['', 'aGVsbG8=', 'aGVs bG8=\n', 'aGVs\u00a0bG8=', 'w5FhbmTDug==', '4piV', '@@@', 'aGVsbG8', '/+8=']],
  ['url-encode', [{}], TEXT],
  ['url-decode', [{}], ['', 'a%20b', '%E2%98%95', 'a+b', '%', '%zz', '%C3']],
  ['jwt-decode', [{}], ['', 'abc', 'a.b', ' eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiLDsSJ9.sig ', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0', 'e30.e30.', 'e30.e30.x.y', 'bm90anNvbg.e30.s', 'eyJhIjoiLV8ifQ.e30.s', `e30.${Buffer.from('{"a":"???>>>~~~"}').toString('base64url')}.s`]],
  ['url-parse', [{}], ['', '   ', 'https://user:pw@example.com:8080/a/b?x=1&x=2&y=3#frag', ' http://h ', 'not a url', 'mailto:a@b.c', 'https://h/?__proto__=1&constructor=2']],
  ['regex-replace', [{ pattern: '', flags: 'g', replacement: 'x' }, { pattern: 'l+', flags: 'g', replacement: '[$&]' }, { pattern: '(h)(e)', flags: '', replacement: '$2$1' }, { pattern: 'O', flags: 'gi', replacement: '//=> $0' }, { pattern: '(', flags: 'g', replacement: '' }, { pattern: 'a', flags: 'zz', replacement: '' }, { pattern: '\\d', flags: 'gu', replacement: '`${x}"\n' }], ['', 'hello world', 'a1b2']],
  ['hash', [{ algorithm: 'SHA-1' }, { algorithm: 'SHA-256' }, { algorithm: 'SHA-384' }, { algorithm: 'SHA-512' }], TEXT],
  ['timestamp', [{}], ['', ' ', '0', '1700000000', ' 1700000000000 ', '-1', '-86400', '2024-02-29T12:00:00Z', '2024-02-29', 'nonsense', '99999999999', '100000000000', '99999999999999999999', '1.5']],
  ['string-case', [{ target: 'lower' }, { target: 'upper' }, { target: 'title' }, { target: 'camel' }, { target: 'snake' }, { target: 'kebab' }], ['', ' ', 'helloWorld fooBar', 'HTTPServer_id-v2/a.b', 'ñandú CAFÉ', 'one  two\nthree']],
  ['html-entity-encode', [{}], TEXT],
  ['html-entity-decode', [{}], ['', '&amp;&lt;&gt;&quot;&apos;&nbsp;&copy;&reg;&trade;&hellip;&mdash;&ndash;', '&#65;&#x41;&#X41;&#128512;', '&unknown; &constructor; &__proto__;', '&#1114112; &#x110000; &#xD800;', '&amp;amp;', '&', '&#;']],
  ['number-base', [{ from: 'auto', to: '16', prefixOutput: true }, { from: 'auto', to: '2', prefixOutput: false }, { from: '10', to: '8', prefixOutput: true }, { from: '16', to: '10', prefixOutput: true }, { from: '2', to: '36', prefixOutput: true }, { from: '8', to: '10', prefixOutput: false }], ['', ' ', '255', '-255', '+7', '0xff', '-0XFF', '0b101', '0o17', '1_000', 'ff', 'zz', '10', '0', '-0', '123456789012345678901234567890', '0x', '1.5', '10x1', '0_xff', '0x_ff', '+-5', '- 5', '0b101', '0B1_01']],
  ['line-sort', [{ direction: 'asc', caseInsensitive: false, unique: false, numeric: false }, { direction: 'desc', caseInsensitive: false, unique: false, numeric: false }, { direction: 'asc', caseInsensitive: true, unique: true, numeric: false }, { direction: 'asc', caseInsensitive: false, unique: false, numeric: true }, { direction: 'desc', caseInsensitive: true, unique: true, numeric: true }], ['', '\n', 'b\na\nC\nb\n', 'b\r\na\rA\nB', 'item10\nitem2\nitem1', 'é\ne\nz\nZ']],
  ['slugify', [{ separator: 'hyphen', lowercase: true }, { separator: 'underscore', lowercase: true }, { separator: 'hyphen', lowercase: false }, { separator: 'dash', lowercase: true }, { separator: 'underscore', lowercase: false }], ['', '  ', 'Hello, World!', 'Ñandú café', '--a__b--', 'ﬁ ½ ²']],
  ['text-stats', [{}], TEXT],
];

describe('buildPipelineJs matches the utilities it replaces', () => {
  it.each(CASES.flatMap(([id, optionSets, inputs]) => optionSets.map((options) => [id, JSON.stringify(options), options, inputs] as const)))(
    '%s with %s',
    async (id, _name, options, inputs) => {
      for (const input of inputs) await expectSame([step(id, options)], input);
    }
  );

  it('uses the defaults the engine uses when saved options no longer parse', async () => {
    for (const [id, , inputs] of CASES) {
      for (const input of inputs.slice(0, 3)) await expectSame([step(id, { indent: {}, target: 7, algorithm: 'MD5', separator: 1 })], input);
    }
  });

  it('feeds each step the output of the one before', async () => {
    const chain = (...ids: UtilityAdapterId[]) => ids.map((id, index) => step(id, undefined, index));
    await expectSame(chain('json-minify', 'base64-encode', 'url-encode', 'url-decode', 'base64-decode', 'json-format'), '{ "a": [1, 2] }');
    await expectSame(chain('string-case', 'slugify', 'text-stats', 'line-sort', 'hash'), 'Hello bigWorld');
    await expectSame(chain('json-minify', 'hash'), '{bad');
  });

  it('runs the starter pipelines that have no long steps', async () => {
    const inputs: Record<string, string> = {
      'decode-jwt': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.s',
      'hash-base64': 'hello',
      'url-decode-json': '%7B%22a%22%3A1%7D',
      'html-decode': '&lt;b&gt;',
      slugify: 'Hello, World!',
      'base64-decode-json': 'eyJhIjoxfQ==',
      'humanize-timestamp': '1700000000',
    };
    const covered = PIPELINE_TEMPLATES.filter((template) => template.id in inputs);
    expect(covered).toHaveLength(Object.keys(inputs).length);
    for (const template of covered) {
      const steps = template.steps.map((current, index) => step(current.utilityId, current.options, index));
      await expectSame(steps, inputs[template.id]!);
    }
  });
});

describe('buildPipelineJs', () => {
  const LONG: UtilityAdapterId[] = ['color-convert', 'diff-text', 'uuid', 'lorem-ipsum', 'string-inspect', 'cron-phrase'];

  it('treats an id it does not know as a comment, even one on Object.prototype', () => {
    const code = buildPipelineJs([{ id: 's', utilityId: 'constructor', options: {} } as unknown as PipelineStepV1], LABELS);
    expect(code).toContain('// 1. constructor has no short JS form.');
  });

  it('writes a minified format without an indent argument', () => {
    expect(buildPipelineJs([step('json-format', { indent: 'minified' })], LABELS)).toContain('JSON.stringify(JSON.parse(value))');
  });

  it('turns the long utilities into a comment that says so', () => {
    for (const id of LONG) {
      const code = buildPipelineJs([step(id)], LABELS);
      expect(code).toContain(`// 1. ${id} has no short JS form.`);
      expect(code).not.toContain('{\n');
    }
  });

  it('covers every other utility, so a new one has to choose', () => {
    const covered = new Set(CASES.map(([id]) => id));
    expect(UTILITY_ADAPTER_IDS.filter((id) => !covered.has(id)).sort()).toEqual([...LONG].sort());
  });

  it('numbers the steps and keeps going after a comment', async () => {
    const steps = [step('url-encode', undefined, 0), step('uuid', undefined, 1), step('url-decode', undefined, 2)];
    const code = buildPipelineJs(steps, LABELS);
    expect(code).toMatch(/\/\/ 1\. url-encode[\s\S]*\/\/ 2\. uuid has no short JS form\.[\s\S]*\/\/ 3\. url-decode/);
    expect(await runSnippet(code, 'a b')).toEqual(['a b']);
  });

  it('starts from an empty value and carries the input comment, whatever the steps hold', () => {
    const code = buildPipelineJs([step('regex-replace', { pattern: 'x', flags: 'g', replacement: 'SECRET' })], LABELS);
    expect(code.startsWith(`// ${LABELS.input}\nlet value = "";\n`)).toBe(true);
    expect(code.trimEnd().endsWith('console.log(value);')).toBe(true);
    expect(buildPipelineJs([], LABELS)).toBe(`// ${LABELS.input}\nlet value = "";\n\nconsole.log(value);\n`);
  });

  it('keeps a title on its comment line, whatever it holds', () => {
    const code = buildPipelineJs([step('uuid')], { ...LABELS, skipped: () => 'one\nvalue = 1;\u2028value = 2;' });
    expect(code.split('\n').filter((line) => line.includes('value = 1'))).toEqual(['// 1. one value = 1; value = 2;']);
  });

  it.each([
    ['a directive', { pattern: '//=> x', flags: 'g', replacement: '// @timeout 1' }],
    ['a bidi control', { pattern: 'a\u202eb', flags: 'g', replacement: 'c\u2066d' }],
    ['a hash directive', { pattern: '^(a+)+$|#@timeout 600', flags: '', replacement: '#  @origin off' }],
    ['line separators and an Arabic mark', { pattern: 'a\u2028b\u2029c\u061cd', flags: 'g', replacement: '' }],
    ['a closing quote and code', { pattern: '");throw 1;//', flags: 'g', replacement: '");throw 2;//' }],
  ])('keeps %s in a regex option inert', async (_name, options) => {
    const code = buildPipelineJs([step('regex-replace', options)], LABELS);
    expect(code).not.toMatch(/\/\/\s*(=>|@timeout)/);
    expect(extractTimeoutMagicComment('javascript', code)).toBeNull();
    expect(originSuppressedByMagicComment('javascript', code)).toBe(false);
    expect(code).not.toMatch(/[\u061c\u2028\u2029\u202e\u2066]/);
    await expectSame([step('regex-replace', options)], `${options.pattern} rest`);
  });
});
