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
      // RL-044 Slice 1C fold F — error kind now bucketed distinctly
      // so Python exception payloads survive the telemetry redactor
      // (and dashboards can count error payloads separately).
      [{ kind: 'error', message: 'nope' }, 'error'],
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
    // RL-044 Slice 2a: stack-less errors stay on the text path; the
    // dispatcher only opens the popover when a structured `stack`
    // is present.
    expect(payloadHasRichSurface({ kind: 'error', message: 'oh' })).toBe(false);
    // Chart remains a stub until Slice 2b (vega-lite).
    expect(payloadHasRichSurface({ kind: 'chart', spec: {} })).toBe(false);
  });

  it('payloadHasRichSurface activates for tables, maps, sets, objects, arrays, dates, promises, rawText, image, html, error+stack', () => {
    expect(payloadHasRichSurface({ kind: 'table', columns: [], rows: [] })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'map', size: 0, entries: [] })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'set', size: 0, entries: [] })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'date', iso: 'x' })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'promise', state: 'pending' })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'rawText', text: 'x' })).toBe(true);
    // RL-044 Slice 2a — image / html have dedicated renderers.
    expect(
      payloadHasRichSurface({ kind: 'image', src: 'data:image/png;base64,a', mime: 'png' })
    ).toBe(true);
    expect(payloadHasRichSurface({ kind: 'html', html: '<p/>' })).toBe(true);
    // RL-044 Slice 2a — error WITH stack opens the popover.
    expect(
      payloadHasRichSurface({
        kind: 'error',
        message: 'boom',
        stack: [{ text: 'at x', file: 'x.ts', line: 1 }],
      })
    ).toBe(true);
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
