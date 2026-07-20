import { describe, expect, it } from 'vitest';
import {
  clampHtmlHeight,
  DEFAULT_HTML_PAYLOAD_HEIGHT_PX,
  MAX_CHART_DATA_VALUES,
  MAX_CHART_SPEC_NODES,
  MAX_HTML_PAYLOAD_HEIGHT_PX,
  MAX_HTML_PAYLOAD_LENGTH,
  MAX_IMAGE_SRC_LENGTH,
  isExtendedRichKind,
  isRichOutputPayload,
  validateChartSpec,
  validateHtmlPayload,
  validateImageSrc,
  type RichOutputHtml,
} from '../../src/shared/richOutput';

describe('implementation — validateImageSrc', () => {
  it('accepts data:image/ URLs', () => {
    expect(validateImageSrc('data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc'
    );
    expect(validateImageSrc('data:image/svg+xml,<svg/>')).toBe(
      'data:image/svg+xml,<svg/>'
    );
  });

  it('accepts blob: URLs', () => {
    expect(validateImageSrc('blob:https://example.com/abc-def')).toBe(
      'blob:https://example.com/abc-def'
    );
  });

  it('accepts https:// URLs', () => {
    expect(validateImageSrc('https://example.com/x.png')).toBe(
      'https://example.com/x.png'
    );
  });

  it('rejects http:// (mixed content)', () => {
    expect(validateImageSrc('http://example.com/x.png')).toBeNull();
  });

  it('rejects javascript: scheme', () => {
    expect(validateImageSrc('javascript:alert(1)')).toBeNull();
  });

  it('rejects vbscript: scheme', () => {
    expect(validateImageSrc('vbscript:msgbox(1)')).toBeNull();
  });

  it('rejects file: scheme', () => {
    expect(validateImageSrc('file:///etc/passwd')).toBeNull();
  });

  it('rejects non-image data: URLs', () => {
    expect(validateImageSrc('data:text/html,<script>x</script>')).toBeNull();
  });

  it('rejects empty / whitespace / non-string', () => {
    expect(validateImageSrc('')).toBeNull();
    expect(validateImageSrc('   ')).toBeNull();
    expect(validateImageSrc(undefined)).toBeNull();
    expect(validateImageSrc(123)).toBeNull();
    expect(validateImageSrc(null)).toBeNull();
  });

  it('rejects sources over the size cap', () => {
    const over = 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_SRC_LENGTH);
    expect(validateImageSrc(over)).toBeNull();
  });

  it('case-insensitive prefix matching', () => {
    expect(validateImageSrc('DATA:image/png;base64,abc')).toBe(
      'DATA:image/png;base64,abc'
    );
    expect(validateImageSrc('HTTPS://example.com/x.png')).toBe(
      'HTTPS://example.com/x.png'
    );
  });
});

describe('implementation — clampHtmlHeight', () => {
  it('returns the default when no height is requested', () => {
    expect(clampHtmlHeight(undefined)).toBe(DEFAULT_HTML_PAYLOAD_HEIGHT_PX);
  });

  it('returns the default for non-finite / non-positive inputs', () => {
    expect(clampHtmlHeight(NaN)).toBe(DEFAULT_HTML_PAYLOAD_HEIGHT_PX);
    expect(clampHtmlHeight(Infinity)).toBe(DEFAULT_HTML_PAYLOAD_HEIGHT_PX);
    expect(clampHtmlHeight(0)).toBe(DEFAULT_HTML_PAYLOAD_HEIGHT_PX);
    expect(clampHtmlHeight(-10)).toBe(DEFAULT_HTML_PAYLOAD_HEIGHT_PX);
  });

  it('passes through values under the cap', () => {
    expect(clampHtmlHeight(100)).toBe(100);
    expect(clampHtmlHeight(500.7)).toBe(500);
  });

  it('clamps over the cap', () => {
    expect(clampHtmlHeight(10_000)).toBe(MAX_HTML_PAYLOAD_HEIGHT_PX);
    expect(clampHtmlHeight(MAX_HTML_PAYLOAD_HEIGHT_PX)).toBe(
      MAX_HTML_PAYLOAD_HEIGHT_PX
    );
  });
});

describe('implementation — validateHtmlPayload', () => {
  it('accepts a normal html string', () => {
    expect(validateHtmlPayload('<div>Hello</div>')).toBe('<div>Hello</div>');
  });

  it('rejects empty / non-string', () => {
    expect(validateHtmlPayload('')).toBeNull();
    expect(validateHtmlPayload(undefined)).toBeNull();
    expect(validateHtmlPayload(null)).toBeNull();
    expect(validateHtmlPayload({})).toBeNull();
  });

  it('rejects over-the-cap payloads', () => {
    const over = 'a'.repeat(MAX_HTML_PAYLOAD_LENGTH + 1);
    expect(validateHtmlPayload(over)).toBeNull();
    expect(validateHtmlPayload('a'.repeat(MAX_HTML_PAYLOAD_LENGTH))).not.toBeNull();
  });
});

describe('implementation — RichOutputHtml discriminator', () => {
  it('isRichOutputPayload accepts html kind', () => {
    const payload: RichOutputHtml = { kind: 'html', html: '<p>x</p>' };
    expect(isRichOutputPayload(payload)).toBe(true);
  });

  it('isExtendedRichKind accepts html kind', () => {
    const payload: RichOutputHtml = { kind: 'html', html: '<p>x</p>' };
    expect(isExtendedRichKind(payload)).toBe(true);
  });

  it('isRichOutputPayload rejects unknown kinds', () => {
    expect(isRichOutputPayload({ kind: 'video' })).toBe(false);
  });
});

describe('implementation — validateChartSpec', () => {
  it('accepts a minimal vega-lite spec with inline data.values', () => {
    const spec = {
      mark: 'bar',
      data: { values: [{ a: 'A', b: 1 }] },
      encoding: { x: { field: 'a', type: 'nominal' }, y: { field: 'b', type: 'quantitative' } },
    };
    expect(validateChartSpec(spec)).toBe(spec);
  });

  it('accepts a spec without data (composition parent)', () => {
    const spec = { layer: [{ mark: 'point' }, { mark: 'line' }] };
    expect(validateChartSpec(spec)).toBe(spec);
  });

  it('accepts spec with empty data object', () => {
    const spec = { mark: 'bar', data: {} };
    expect(validateChartSpec(spec)).toBe(spec);
  });

  it('rejects spec with data.url (anti-feature §A-008 — no silent fetches)', () => {
    expect(
      validateChartSpec({
        mark: 'bar',
        data: { url: 'https://example.com/data.csv' },
      })
    ).toBeNull();
  });

  it('rejects nested data.url inside composition specs', () => {
    expect(
      validateChartSpec({
        layer: [
          {
            mark: 'line',
            data: { values: [{ x: 1, y: 2 }] },
          },
          {
            mark: 'point',
            data: { url: 'https://example.com/points.csv' },
          },
        ],
      })
    ).toBeNull();
  });

  it('rejects spec with data.name (named-dataset reference)', () => {
    expect(
      validateChartSpec({
        mark: 'bar',
        data: { name: 'remote-dataset' },
      })
    ).toBeNull();
  });

  it('rejects nested data.name inside repeated specs', () => {
    expect(
      validateChartSpec({
        repeat: ['a', 'b'],
        spec: {
          mark: 'bar',
          data: { name: 'dataset-from-elsewhere' },
        },
      })
    ).toBeNull();
  });

  it('rejects non-object specs', () => {
    expect(validateChartSpec(null)).toBeNull();
    expect(validateChartSpec(undefined)).toBeNull();
    expect(validateChartSpec('spec string')).toBeNull();
    expect(validateChartSpec(42)).toBeNull();
    expect(validateChartSpec([])).toBeNull();
  });

  it('rejects spec when data.values is not an array', () => {
    expect(
      validateChartSpec({ mark: 'bar', data: { values: 'not-an-array' } })
    ).toBeNull();
  });

  it('rejects spec when data.values exceeds MAX_CHART_DATA_VALUES', () => {
    const over = Array.from({ length: MAX_CHART_DATA_VALUES + 1 }, (_, i) => ({ x: i }));
    expect(validateChartSpec({ mark: 'bar', data: { values: over } })).toBeNull();
    const atLimit = Array.from({ length: MAX_CHART_DATA_VALUES }, (_, i) => ({ x: i }));
    expect(validateChartSpec({ mark: 'bar', data: { values: atLimit } })).not.toBeNull();
  });

  it('rejects cyclic or excessively deep specs without throwing', () => {
    const cyclic: Record<string, unknown> = { mark: 'point' };
    cyclic.self = cyclic;
    expect(() => validateChartSpec(cyclic)).not.toThrow();
    expect(validateChartSpec(cyclic)).toBeNull();

    let deep: Record<string, unknown> = { mark: 'point' };
    const root = deep;
    for (let i = 0; i < MAX_CHART_SPEC_NODES + 1; i += 1) {
      const next: Record<string, unknown> = {};
      deep.next = next;
      deep = next;
    }
    expect(validateChartSpec(root)).toBeNull();
  });

  it('rejects specs with throwing getters without throwing', () => {
    const spec = {
      mark: 'point',
      get encoding() {
        throw new Error('getter boom');
      },
    };

    expect(() => validateChartSpec(spec)).not.toThrow();
    expect(validateChartSpec(spec)).toBeNull();
  });

  it('rejects specs with throwing data getters without throwing', () => {
    const spec = {
      mark: 'point',
      data: {
        get values() {
          throw new Error('values boom');
        },
      },
    };

    expect(() => validateChartSpec(spec)).not.toThrow();
    expect(validateChartSpec(spec)).toBeNull();
  });
});
