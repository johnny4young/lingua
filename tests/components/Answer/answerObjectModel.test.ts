import { describe, expect, it } from 'vitest';
import { readLiteral } from '@/components/Answer/answerLiteral';
import { detectColour, detectGauge, detectIsoDate } from '@/components/Answer/answerDetectors';
import { formatAnswerNumber, readAnswer, type AnswerInput } from '@/components/Answer/answerObjectModel';
import type { RichOutputPayload } from '../../../src/shared/richOutput';

const NOW = Date.UTC(2026, 10, 11, 11, 0);
const read = (input: AnswerInput | string) =>
  readAnswer(typeof input === 'string' ? { text: input } : input, { now: NOW, locale: 'en' });
const py = (text: string, source?: string) => read({ text, language: 'python', source });
const num = (repr: string) => ({ kind: 'primitive', type: 'number', repr }) as const;
const str = (repr: string) => ({ kind: 'primitive', type: 'string', repr }) as const;

describe('readLiteral', () => {
  it('reads JSON, Python reprs and JS object keys', () => {
    expect(readLiteral('[1, 2.5, -3]')).toEqual({
      t: 'list',
      shape: 'list',
      items: [
        { t: 'num', v: 1, raw: '1' },
        { t: 'num', v: 2.5, raw: '2.5' },
        { t: 'num', v: -3, raw: '-3' },
      ],
    });
    expect(readLiteral("{'a': True, 'b': None}")).toEqual({
      t: 'dict',
      entries: [
        { key: 'a', value: { t: 'bool', v: true } },
        { key: 'b', value: { t: 'none', raw: 'None' } },
      ],
    });
    expect(readLiteral('{ api: "x" }')).toEqual({ t: 'dict', entries: [{ key: 'api', value: { t: 'str', v: 'x' } }] });
    expect(readLiteral('(1, 2)')).toMatchObject({ t: 'list', shape: 'tuple' });
    expect(readLiteral("{'a', 'b'}")).toMatchObject({ t: 'list', shape: 'set' });
    expect(readLiteral('{}')).toEqual({ t: 'dict', entries: [] });
    expect(readLiteral('"a\\nb"')).toEqual({ t: 'str', v: 'a\nb' });
    expect(readLiteral('-inf')).toMatchObject({ t: 'num', v: Number.NEGATIVE_INFINITY });
  });

  it('refuses text that is not a whole literal', () => {
    expect(readLiteral('hello world')).toBeUndefined();
    expect(readLiteral('[1, 2')).toBeUndefined();
    expect(readLiteral('<Foo object at 0x1>')).toBeUndefined();
    expect(readLiteral('[1] trailing')).toBeUndefined();
    expect(readLiteral('-True')).toBeUndefined();
    expect(readLiteral(`[${'1,'.repeat(15_000)}1]`)).toBeUndefined();
    expect(readLiteral('['.repeat(40) + ']'.repeat(40))).toBeUndefined();
  });
});

describe('detectors', () => {
  it('accepts hex, rgb() and hsl() colours only', () => {
    expect(detectColour('#7FD8C4')).toBe('#7FD8C4');
    expect(detectColour('#fff')).toBe('#fff');
    expect(detectColour('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(detectColour(' hsl(210, 40%, 50%) ')).toBe('hsl(210, 40%, 50%)');
    expect(detectColour('rgb(999, 0, 0)')).toBeNull();
    expect(detectColour('hsl(0, 140%, 50%)')).toBeNull();
    expect(detectColour('#12345')).toBeNull();
    expect(detectColour('red')).toBeNull();
    expect(detectColour('rgb(1,2,3); background:url(x)')).toBeNull();
  });

  it('reads ISO dates', () => {
    expect(detectIsoDate('2026-11-11T14:02:00.000Z')).toBe(Date.UTC(2026, 10, 11, 14, 2));
    expect(detectIsoDate('2026-11-11')).not.toBeNull();
    expect(detectIsoDate('11/11/2026')).toBeNull();
    // A bare date is that day in local time, not UTC midnight.
    expect(detectIsoDate('2026-11-11')).toBe(new Date(2026, 10, 11).getTime());
    expect(detectIsoDate('2026-02-30')).toBeNull();
  });

  it('gauges a number against a threshold written in the statement', () => {
    expect(detectGauge('budget = 120 - p95[slowest]', -31.4)).toEqual({ threshold: 120, measured: 151.4, over: true });
    expect(detectGauge('const headroom = 120 - p95.db; // budget', 63.2)).toMatchObject({ measured: 56.8, over: false });
    expect(detectGauge('excess = latency - 100', 12)).toEqual({ threshold: 100, measured: 112, over: true });
    expect(detectGauge('total = a + b - 100', 3)).toBeNull();
    expect(detectGauge('x = 2024 - 1990', 34)).toBeNull();
    expect(detectGauge('x = 0 - y', 3)).toBeNull();
    expect(detectGauge('x = y * 2', 3)).toBeNull();
    expect(detectGauge('const last = items.length - 1;', 4)).toBeNull();
    expect(detectGauge('last = len(xs) - 1', 4)).toBeNull();
    expect(detectGauge('prev = i - 1', 4)).toBeNull();
  });
});

describe('readAnswer', () => {
  it('draws up to 24 numbers as bars with their range', () => {
    const model = py('[38, 41, 35, 44, 39, 52, 37]');
    expect(model).toMatchObject({ tag: 'list·7', tone: 'number', value: '35 – 52' });
    expect(model.picture).toMatchObject({ kind: 'bars', low: '35', high: '52' });
    if (model.picture?.kind !== 'bars') throw new Error('bars');
    expect(model.picture.heights).toHaveLength(7);
    expect(Math.max(...model.picture.heights)).toBe(100);
    expect(read('[1, 2]').tag).toBe('array·2');
  });

  it('draws a longer series as a spark with its mean', () => {
    const model = read(JSON.stringify(Array.from({ length: 50 }, (_, i) => i)));
    expect(model.picture).toMatchObject({ kind: 'spark', mean: '24.5' });
    expect(model.value).toBe('μ 24.5');
    if (model.picture?.kind !== 'spark') throw new Error('spark');
    expect(model.picture.points.length).toBeLessThanOrEqual(48);
  });

  it('puts a dict of numbers on one shared scale', () => {
    const model = py("{'api': 40.9, 'worker': 13.1, 'db': 96.9}");
    expect(model.tag).toBe('dict·3');
    expect(model.picture).toEqual({
      kind: 'scale',
      more: 0,
      entries: [
        { label: 'api', value: '40.9', width: (40.9 / 96.9) * 100 },
        { label: 'worker', value: '13.1', width: (13.1 / 96.9) * 100 },
        { label: 'db', value: '96.9', width: 100 },
      ],
    });
  });

  it('names the keys of a dict whose values share a type', () => {
    expect(py("{'api': [1, 2], 'db': [3, 4]}").picture).toEqual({ kind: 'keys', keys: ['api', 'db'], each: 'list·2', more: 0 });
    expect(py("{'api': [1], 'db': [3, 4]}").picture).toMatchObject({ each: 'list' });
    expect(py("{'a': 1, 'b': 'x'}")).toMatchObject({ tone: 'plain', value: "{a: 1, b: 'x'}" });
  });

  it('draws a list of dicts as a compact table with bars on measurable columns', () => {
    const model = py("[{'service': 'api', 'avg': 40.9, 'ok': True}, {'service': 'db', 'avg': 96.9, 'ok': False}]");
    expect(model.picture?.kind).toBe('table');
    if (model.picture?.kind !== 'table') throw new Error('table');
    expect(model.picture.columns).toEqual(['service', 'avg', 'ok']);
    expect(model.picture.rows[0]).toEqual([
      { text: "'api'", tone: 'string' },
      { text: '40.9', tone: 'number', bar: (40.9 / 96.9) * 100 },
      { text: 'True', tone: 'boolean' },
    ]);
  });

  it('caps a table at six rows and five columns', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: i, a: i, b: i, c: i, d: i, e: i, f: i }));
    const model = read(JSON.stringify(rows));
    if (model.picture?.kind !== 'table') throw new Error('table');
    expect(model.picture.columns).toEqual(['id', 'a', 'b', 'c', 'd']);
    expect(model.picture.rows).toHaveLength(6);
    expect(model.picture.more).toBe(3);
    // A key column never measures.
    expect(model.picture.rows[1]![0]!.bar).toBeUndefined();
    expect(model.picture.rows[1]![1]!.bar).toBeDefined();
  });

  it('shows colour chips for colour strings', () => {
    expect(py("'#FF7566'").picture).toEqual({ kind: 'colours', chips: [{ text: '#FF7566', css: '#FF7566' }], more: 0 });
    expect(read({ text: "{'api': '#7FD8C4', 'db': 'hsl(0, 50%, 50%)'}", language: 'python' }).picture).toMatchObject({
      kind: 'colours',
      chips: [
        { label: 'api', text: '#7FD8C4' },
        { label: 'db', text: 'hsl(0, 50%, 50%)' },
      ],
    });
    expect(read('["#000", "#fff"]').picture).toMatchObject({ kind: 'colours', chips: [{ text: '#000' }, { text: '#fff' }] });
  });

  it('gauges a number against the threshold in its statement', () => {
    const model = py('-31.400000000000006', 'budget = 120 - p95[slowest]');
    expect(model).toMatchObject({ tag: 'float', tone: 'number', value: '-31.4', pill: true });
    expect(model.picture).toMatchObject({ kind: 'gauge', over: true, threshold: '120' });
    expect(py('7').tag).toBe('int');
    expect(read('7').tag).toBe('number');
  });

  it('dates read as relative time, from ISO text, Python reprs and date payloads', () => {
    const iso = read('"2026-11-11T14:00:00.000Z"');
    expect(iso).toMatchObject({ tag: 'date', tone: 'date', picture: { kind: 'relative', text: 'in 3 hr.' } });
    expect(py('datetime.datetime(2026, 11, 11, 14, 2)').tag).toBe('datetime');
    expect(read({ text: '', payload: { kind: 'date', iso: '2026-11-11T08:00:00.000Z' } }).picture).toEqual({ kind: 'relative', text: '3 hr. ago' });
  });

  it('keeps booleans and None neutral and errors red', () => {
    expect(py('True')).toMatchObject({ tag: 'bool', tone: 'boolean', value: 'True' });
    expect(py('None')).toMatchObject({ tag: 'none', tone: 'none' });
    expect(read('null')).toMatchObject({ tag: 'null', tone: 'none' });
    expect(read({ text: "KeyError: 'cache'", role: 'error' })).toMatchObject({ tag: 'error', tone: 'error', value: "KeyError: 'cache'" });
    const tones = [py('True'), py('1'), py("'x'"), py('[1, 2]')].map(model => model.tone);
    expect(tones).not.toContain('error');
  });

  it('folds long strings to their first line', () => {
    expect(py("'slowest path: db\\nnext: worker\\nlast: api'")).toMatchObject({ value: "'slowest path: db'", fold: 2 });
    expect(read('plain text')).toMatchObject({ tag: 'string', value: '"plain text"', fold: 0 });
    expect(read({ text: 'a\nb', role: 'stdout' })).toMatchObject({ tag: 'stdout', tone: 'plain', value: 'a', fold: 1 });
  });

  it('reads text as is, sized by its characters', () => {
    expect(read({ text: '{"a":1}', role: 'text' })).toMatchObject({ tag: 'text·7', kind: 'text', tone: 'string', value: '{"a":1}', pill: false });
    expect(read({ text: '42\nnext', role: 'text' })).toMatchObject({ tag: 'text·7', value: '42', fold: 1 });
    // A head of a longer text keeps the full size and lays out only what three lines can show.
    const head = read({ text: 'x'.repeat(2000), role: 'text', length: 25_000 });
    expect(head.tag).toBe('text·25000');
    expect(head.value.length).toBeLessThanOrEqual(600);
  });

  it('reads every rich payload kind', () => {
    const cases: Array<[RichOutputPayload, string, string | undefined]> = [
      [{ kind: 'table', columns: ['a'], rows: [[num('1')], [num('2')]] }, 'table·2', 'table'],
      [{ kind: 'map', size: 2, entries: [{ key: str('"x"'), value: num('1') }, { key: str('"y"'), value: num('3') }] }, 'map·2', 'scale'],
      [{ kind: 'set', size: 2, entries: [num('1'), num('2')] }, 'set·2', 'bars'],
      [{ kind: 'array', length: 30, entries: Array.from({ length: 30 }, (_, i) => ({ index: i, value: num(String(i)) })) }, 'array·30', 'spark'],
      [{ kind: 'object', previewType: 'Object', entries: [{ key: 'a', value: num('1') }] }, 'object·1', 'scale'],
      [{ kind: 'primitive', type: 'boolean', repr: 'true' }, 'boolean', undefined],
      [{ kind: 'function', name: 'f' }, 'function', undefined],
      [{ kind: 'promise', state: 'pending' }, 'promise', undefined],
      [{ kind: 'progress', id: 'p', label: 'load', value: 0.5 }, 'progress', 'progress'],
      [{ kind: 'image', src: 'data:', mime: 'image/png' }, 'image', undefined],
      [{ kind: 'html', html: '<b>x</b>' }, 'html', undefined],
      [{ kind: 'chart', spec: {} }, 'chart', undefined],
      [{ kind: 'error', message: 'boom' }, 'error', undefined],
      [{ kind: 'rawText', text: 'x' }, 'string', undefined],
    ];
    for (const [payload, tag, picture] of cases) {
      const model = read({ text: 'x', payload });
      expect([model.tag, model.picture?.kind]).toEqual([tag, picture]);
    }
  });

  it('formats numbers without float noise', () => {
    expect(formatAnswerNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatAnswerNumber(42, '42')).toBe('42');
    expect(formatAnswerNumber(Number.NaN, 'nan')).toBe('nan');
    expect(formatAnswerNumber(12345678901.5, '12345678901.5')).toBe('12345678901.5');
    expect(formatAnswerNumber(1e30, '1000000000000000000000000000000')).toBe('1000000000000000000000000000000');
    expect(formatAnswerNumber(1, '1.0')).toBe('1.0');
  });

  it('keeps a console.table payload on console output', () => {
    const payload: RichOutputPayload = { kind: 'table', columns: ['a'], rows: [[num('1')], [num('2')]] };
    expect(read({ text: 'Table(2×1)', role: 'stdout', payload }).picture?.kind).toBe('table');
    expect(read({ text: 'hello', role: 'stdout' }).kind).toBe('stdout');
    expect(read({ text: 'hello', role: 'stdout', payload: { kind: 'primitive', type: 'string', repr: '"hello"' } }).kind).toBe('stdout');
  });

  it('reads pretty-printed JSON too large to parse as an array, not a string', () => {
    const model = read(JSON.stringify(Array.from({ length: 3000 }, (_, i) => i), null, 2));
    expect([model.kind, model.tag]).toEqual(['array', 'array']);
  });

  it('drops the open quote of a clamped string repr and keeps unreadable table cells', () => {
    const object: RichOutputPayload = { kind: 'object', previewType: 'Object', entries: [{ key: 'a', value: str('"abcdefg') }] };
    expect(read({ text: 'x', payload: object }).value).toBe('{a: "abcdefg"}');
    const table: RichOutputPayload = { kind: 'table', columns: ['f'], rows: [[{ kind: 'function', name: 'go' }]] };
    const picture = read({ text: 'x', payload: table }).picture;
    expect(picture?.kind === 'table' ? picture.rows[0]![0]!.text : null).toBe('[Function: go]');
  });
});
