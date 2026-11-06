import { describe, expect, it } from 'vitest';
import { buildDisplayPayload, buildProgressPayload, progressText } from '../../src/shared/richDisplay';
import { progressIdOf } from '../../src/shared/richOutput';

describe('lingua.display payloads', () => {
  it('detects tables, text, images and objects, and forces a kind with as', () => {
    expect(buildDisplayPayload([{ city: 'Envigado', orders: 42 }])).toMatchObject({ payload: { kind: 'table', columns: ['city', 'orders'] }, text: expect.stringContaining('Table(1×2)') });
    expect(buildDisplayPayload('hello')).toEqual({ payload: { kind: 'rawText', text: 'hello' }, text: 'hello' });
    expect(buildDisplayPayload('data:image/svg+xml;base64,AAAA')).toMatchObject({ payload: { kind: 'image', mime: 'image/svg+xml' } });
    expect(buildDisplayPayload({ a: 1 })).toMatchObject({ payload: { kind: 'object' }, text: '{"a":1}' });
    expect(buildDisplayPayload([1, 2])).toMatchObject({ text: '[1,2]' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(buildDisplayPayload(cyclic).text).toBe('[object Object]');
    expect(buildDisplayPayload({ long: 'x'.repeat(300) }).text).toHaveLength(120);
    expect(buildDisplayPayload([1, 2], { as: 'table' })).toMatchObject({ payload: { kind: 'table', columns: ['value'] } });
    expect(buildDisplayPayload([{ a: 1 }], { as: 'json' })).toMatchObject({ payload: { kind: 'array' } });
    expect(buildDisplayPayload(42, { as: 'text' })).toEqual({ payload: { kind: 'rawText', text: '42' }, text: '42' });
    expect(buildDisplayPayload('<b>hi</b>')).toMatchObject({ payload: { kind: 'rawText' } });
    expect(buildDisplayPayload('<b>hi</b>', { as: 'html' })).toMatchObject({ payload: { kind: 'html', html: '<b>hi</b>' } });
    expect(buildDisplayPayload({ mark: 'bar', data: { values: [] } }, { as: 'chart' })).toMatchObject({ payload: { kind: 'chart' } });
    expect(buildDisplayPayload({ src: 'https://example.com/a.png', mime: 'image/png' }, { as: 'image' })).toMatchObject({ payload: { kind: 'image', mime: 'image/png' } });
    expect(buildDisplayPayload({ a: 1 }, { as: 'nonsense' })).toMatchObject({ payload: { kind: 'object' } });
  });

  it('applies the value cap to text and json', () => {
    const truncate = (text: string) => (text.length > 10 ? `${text.slice(0, 10)}[cut]` : text);
    expect(buildDisplayPayload('x'.repeat(50), undefined, { truncate })).toEqual({ payload: { kind: 'rawText', text: `${'x'.repeat(10)}[cut]` }, text: `${'x'.repeat(10)}[cut]` });
    expect(buildDisplayPayload(7, { as: 'text' }, { truncate })).toMatchObject({ payload: { text: '7' } });
    expect(JSON.stringify(buildDisplayPayload({ a: 'y'.repeat(5000) }, { as: 'json' }, { truncate })).length).toBeLessThan(300);
  });

  it('rejects unsafe media with the reasons the telemetry knows', () => {
    expect(buildDisplayPayload('javascript:alert(1)', { as: 'image' })).toMatchObject({ rejected: { kind: 'image', reason: 'invalid-src' } });
    expect(buildDisplayPayload('', { as: 'html' })).toMatchObject({ rejected: { kind: 'html', reason: 'validation-failed' } });
    expect(buildDisplayPayload({ data: { url: 'https://x' } }, { as: 'chart' })).toMatchObject({ rejected: { kind: 'chart', reason: 'validation-failed' } });
  });

  it('clamps progress and names the bar it updates', () => {
    const payload = buildProgressPayload('run:1', 'import', 1.7, 'x'.repeat(200));
    expect(payload).toMatchObject({ kind: 'progress', id: 'run:1', label: 'import', value: 1 });
    expect(payload.text).toHaveLength(80);
    expect(buildProgressPayload('run:2', null, Number.NaN)).toEqual({ kind: 'progress', id: 'run:2', label: '', value: 0 });
    expect(progressText(buildProgressPayload('run:3', 'files', 0.64, '16 / 25'))).toBe('files 64% · 16 / 25');
    expect(progressIdOf([payload])).toBe('run:1');
    expect(progressIdOf([{ kind: 'rawText', text: 'x' }])).toBeNull();
    expect(progressIdOf(undefined)).toBeNull();
  });
});
