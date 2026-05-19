import { describe, it, expect } from 'vitest';
import {
  richKindBucket,
  typeIcon,
  payloadHasRichSurface,
  payloadAsJsonString,
} from '@/components/Console/richConsoleFormat';
import type { RichOutputPayload } from '@shared/richOutput';

describe('richConsoleFormat — RL-044 Slice 1B helpers', () => {
  it('richKindBucket maps every payload kind into the closed-enum bucket', () => {
    const cases: Array<[RichOutputPayload, string]> = [
      [{ kind: 'table', columns: [], rows: [] }, 'table'],
      [{ kind: 'map', size: 0, entries: [] }, 'mapSet'],
      [{ kind: 'set', size: 0, entries: [] }, 'mapSet'],
      [{ kind: 'date', iso: '2024-01-01T00:00:00.000Z' }, 'date'],
      [{ kind: 'promise', state: 'pending' }, 'promise'],
      [{ kind: 'rawText', text: 'hello' }, 'rawText'],
      [{ kind: 'image', src: 'x', mime: 'image/png' }, 'image'],
      [{ kind: 'chart', spec: {} }, 'chart'],
      [
        {
          kind: 'object',
          previewType: 'Object',
          entries: [],
          truncatedCount: undefined,
        } as unknown as RichOutputPayload,
        'object',
      ],
      [
        {
          kind: 'array',
          length: 0,
          entries: [],
        } as unknown as RichOutputPayload,
        'array',
      ],
      [
        { kind: 'primitive', type: 'string', repr: '"hi"' },
        'text',
      ],
      [{ kind: 'function', name: 'foo' }, 'text'],
      [{ kind: 'error', message: 'nope' }, 'text'],
    ];

    for (const [payload, expected] of cases) {
      expect(richKindBucket(payload), `kind=${payload.kind}`).toBe(expected);
    }
  });

  it('typeIcon returns a single non-empty glyph for every payload kind', () => {
    const kinds: RichOutputPayload['kind'][] = [
      'primitive',
      'function',
      'object',
      'array',
      'error',
      'map',
      'set',
      'date',
      'promise',
      'table',
      'rawText',
      'image',
      'chart',
    ];
    for (const kind of kinds) {
      const stub = { kind } as unknown as RichOutputPayload;
      const icon = typeIcon(stub);
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  it('payloadHasRichSurface keeps text-only kinds on the legacy path', () => {
    expect(
      payloadHasRichSurface({ kind: 'primitive', type: 'string', repr: 'x' })
    ).toBe(false);
    expect(payloadHasRichSurface({ kind: 'function', name: 'f' })).toBe(false);
    expect(payloadHasRichSurface({ kind: 'error', message: 'oh' })).toBe(false);
    expect(payloadHasRichSurface({ kind: 'image', src: 'x', mime: 'png' })).toBe(false);
    expect(payloadHasRichSurface({ kind: 'chart', spec: {} })).toBe(false);
  });

  it('payloadHasRichSurface activates for tables, maps, sets, objects, arrays, dates, promises, rawText', () => {
    expect(payloadHasRichSurface({ kind: 'table', columns: [], rows: [] })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'map', size: 0, entries: [] })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'set', size: 0, entries: [] })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'date', iso: 'x' })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'promise', state: 'pending' })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'rawText', text: 'x' })).toBe(true);
  });

  it('payloadAsJsonString round-trips a table payload', () => {
    const payload: RichOutputPayload = {
      kind: 'table',
      columns: ['a', 'b'],
      rows: [],
    };
    const json = payloadAsJsonString(payload);
    expect(JSON.parse(json)).toEqual(payload);
  });
});
