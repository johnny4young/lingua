import { describe, expect, it } from 'vitest';
import {
  BASE64_IMAGE_MAX_BYTES,
  decodeDataUri,
  encodeFileToDataUri,
  formatByteSize,
} from '@/utils/base64Image';

const ONE_BY_ONE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe('encodeFileToDataUri', () => {
  it('encodes a PNG file to a data:image/png;base64,... URI', async () => {
    const file = new File([ONE_BY_ONE_PNG], 'pixel.png', { type: 'image/png' });
    const result = await encodeFileToDataUri(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe('image/png');
    expect(result.dataUri.startsWith('data:image/png;base64,')).toBe(true);
    expect(result.byteSize).toBe(ONE_BY_ONE_PNG.byteLength);
  });

  it('rejects non-image MIME types with not-image', async () => {
    const file = new File(['hello'], 'greeting.txt', { type: 'text/plain' });
    const result = await encodeFileToDataUri(file);
    expect(result).toEqual({ ok: false, kind: 'not-image', mime: 'text/plain' });
  });

  it('rejects files over 10 MB with too-large', async () => {
    // Build a large Blob without allocating the underlying bytes — `File`
    // uses the length we declare via the constructor. Use a small Uint8Array
    // repeated in the payload list to mimic oversized content.
    const chunk = new Uint8Array(1024 * 1024);
    const oversized = new File(new Array(11).fill(chunk), 'large.png', {
      type: 'image/png',
    });
    expect(oversized.size).toBeGreaterThan(BASE64_IMAGE_MAX_BYTES);
    const result = await encodeFileToDataUri(oversized);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('too-large');
    if (result.kind === 'too-large') {
      expect(result.maxBytes).toBe(BASE64_IMAGE_MAX_BYTES);
      expect(result.byteSize).toBe(oversized.size);
    }
  });
});

describe('decodeDataUri', () => {
  it('parses a base64 image data-URI and reports the decoded byte size', () => {
    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const result = decodeDataUri(dataUri);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe('image/png');
    expect(result.byteSize).toBeGreaterThan(0);
    expect(result.dataUri).toBe(dataUri);
  });

  it('parses an SVG data-URI with percent-encoded (non-base64) body', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    const result = decodeDataUri(dataUri);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe('image/svg+xml');
    // Byte size matches the decoded SVG string length in UTF-8.
    expect(result.byteSize).toBe(new TextEncoder().encode(svg).byteLength);
  });

  it('trims surrounding whitespace before matching the data: prefix', () => {
    const dataUri =
      '  data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7  ';
    const result = decodeDataUri(dataUri);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataUri.trim()).toBe(result.dataUri);
      expect(result.mime).toBe('image/gif');
    }
  });

  it('rejects non-image MIME with not-image and surfaces the claimed type', () => {
    const result = decodeDataUri('data:text/plain;base64,aGVsbG8=');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('not-image');
    if (result.kind === 'not-image') {
      expect(result.mime).toBe('text/plain');
    }
  });

  it('rejects strings that are not data URIs with invalid-uri', () => {
    expect(decodeDataUri('')).toEqual({ ok: false, kind: 'invalid-uri' });
    expect(decodeDataUri('not-a-uri')).toEqual({ ok: false, kind: 'invalid-uri' });
    expect(decodeDataUri('https://example.com/image.png')).toEqual({
      ok: false,
      kind: 'invalid-uri',
    });
  });

  it('rejects malformed base64 bodies with invalid-base64', () => {
    const result = decodeDataUri('data:image/png;base64,!!!not-base64!!!');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid-base64');
  });

  it('rejects oversized base64 payloads before decoding them', () => {
    const encodedLength = Math.ceil((BASE64_IMAGE_MAX_BYTES + 1) / 3) * 4;
    const result = decodeDataUri(`data:image/png;base64,${'A'.repeat(encodedLength)}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('too-large');
    if (result.kind === 'too-large') {
      expect(result.byteSize).toBeGreaterThan(BASE64_IMAGE_MAX_BYTES);
      expect(result.maxBytes).toBe(BASE64_IMAGE_MAX_BYTES);
    }
  });

  it('rejects oversized percent-encoded payloads before decoding them', () => {
    const result = decodeDataUri(`data:image/svg+xml,${'a'.repeat(BASE64_IMAGE_MAX_BYTES + 1)}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('too-large');
  });
});

describe('formatByteSize', () => {
  it('formats bytes under 1 KB with the raw count', () => {
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(1023)).toBe('1023 B');
  });

  it('formats bytes in the KB range with one decimal', () => {
    expect(formatByteSize(1024)).toBe('1.0 KB');
    expect(formatByteSize(2560)).toBe('2.5 KB');
  });

  it('formats bytes in the MB range with two decimals', () => {
    expect(formatByteSize(1024 * 1024)).toBe('1.00 MB');
    expect(formatByteSize(1024 * 1024 * 3 + 512 * 1024)).toBe('3.50 MB');
  });
});
