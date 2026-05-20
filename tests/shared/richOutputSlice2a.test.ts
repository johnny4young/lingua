import { describe, expect, it } from 'vitest';
import {
  clampHtmlHeight,
  DEFAULT_HTML_PAYLOAD_HEIGHT_PX,
  MAX_HTML_PAYLOAD_HEIGHT_PX,
  MAX_HTML_PAYLOAD_LENGTH,
  MAX_IMAGE_SRC_LENGTH,
  isExtendedRichKind,
  isRichOutputPayload,
  validateHtmlPayload,
  validateImageSrc,
  type RichOutputHtml,
} from '../../src/shared/richOutput';

describe('Slice 2a — validateImageSrc', () => {
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

describe('Slice 2a — clampHtmlHeight', () => {
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

describe('Slice 2a — validateHtmlPayload', () => {
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

describe('Slice 2a — RichOutputHtml discriminator', () => {
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
