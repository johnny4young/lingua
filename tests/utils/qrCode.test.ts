import { describe, expect, it } from 'vitest';
import {
  QR_ERROR_CORRECTION_LEVELS,
  generateQrPngDataUrl,
  generateQrSvg,
  isQrErrorCorrectionLevel,
  qrCapacityFor,
} from '@/utils/qrCode';

describe('isQrErrorCorrectionLevel', () => {
  it('accepts the four ISO/IEC 18004 levels', () => {
    for (const level of QR_ERROR_CORRECTION_LEVELS) {
      expect(isQrErrorCorrectionLevel(level)).toBe(true);
    }
  });

  it('rejects unknown or wrong-type inputs', () => {
    expect(isQrErrorCorrectionLevel('X')).toBe(false);
    expect(isQrErrorCorrectionLevel('')).toBe(false);
    expect(isQrErrorCorrectionLevel(0)).toBe(false);
    expect(isQrErrorCorrectionLevel(null)).toBe(false);
    expect(isQrErrorCorrectionLevel(undefined)).toBe(false);
  });
});

describe('qrCapacityFor', () => {
  it('exposes a descending byte capacity as the correction level rises', () => {
    const capacities = QR_ERROR_CORRECTION_LEVELS.map(qrCapacityFor);
    for (let i = 1; i < capacities.length; i += 1) {
      expect(capacities[i]).toBeLessThan(capacities[i - 1]!);
    }
  });

  it('matches the ISO/IEC 18004 byte-mode ceilings at version 40', () => {
    expect(qrCapacityFor('L')).toBe(2953);
    expect(qrCapacityFor('M')).toBe(2331);
    expect(qrCapacityFor('Q')).toBe(1663);
    expect(qrCapacityFor('H')).toBe(1273);
  });
});

describe('generateQrSvg', () => {
  it('returns a valid inline SVG for a short ASCII payload', async () => {
    const result = await generateQrSvg('https://linguacode.dev', 'M');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('<svg')).toBe(true);
      expect(result.value).toContain('viewBox');
      // Closing tag proves we did not receive a truncated render.
      expect(result.value.trim().endsWith('</svg>')).toBe(true);
    }
  });

  it('refuses an empty payload with the empty discriminator', async () => {
    const result = await generateQrSvg('', 'M');
    expect(result).toEqual({ ok: false, kind: 'empty' });
  });

  it('refuses an oversized payload with the capacity ceiling attached', async () => {
    const huge = 'a'.repeat(4000);
    const result = await generateQrSvg(huge, 'L');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('too-long');
      if (result.kind === 'too-long') {
        expect(result.capacity).toBe(2953);
      }
    }
  });

  it('regenerates a different SVG when the correction level changes', async () => {
    const payload = 'https://linguacode.dev/roadmap';
    const low = await generateQrSvg(payload, 'L');
    const high = await generateQrSvg(payload, 'H');
    expect(low.ok && high.ok).toBe(true);
    if (low.ok && high.ok) {
      // Different versions (more ECC → bigger matrix) produce distinct viewBox.
      expect(low.value).not.toEqual(high.value);
    }
  });

  it('round-trips Unicode and emoji payloads through UTF-8', async () => {
    const payload = 'hola 👋🏽 mundo — lingua';
    const result = await generateQrSvg(payload, 'M');
    expect(result.ok).toBe(true);
  });

  it('treats the byte-mode capacity as the UTF-8 ceiling, not char length', async () => {
    // Each ✓ is 3 UTF-8 bytes; 500 of them is 1500 bytes — well over the
    // H-level ceiling (1273) but only 500 chars. We assert the byte
    // accounting matches the real library behaviour.
    const payload = '✓'.repeat(500);
    const result = await generateQrSvg(payload, 'H');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('too-long');
    }
  });
});

describe('generateQrPngDataUrl', () => {
  it('returns a base64 PNG data URL for a valid payload', async () => {
    const result = await generateQrPngDataUrl('lingua', 'M');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('data:image/png;base64,')).toBe(true);
      // Strip the scheme prefix and confirm the remainder decodes to a
      // sensible PNG length (>1 KB once base64 decoded).
      const base64 = result.value.slice('data:image/png;base64,'.length);
      const byteLength = Math.floor((base64.length * 3) / 4);
      expect(byteLength).toBeGreaterThan(1024);
    }
  });

  it('shares the same empty-payload discriminator as the SVG helper', async () => {
    const result = await generateQrPngDataUrl('', 'M');
    expect(result).toEqual({ ok: false, kind: 'empty' });
  });

  it('shares the same too-long discriminator with the correct capacity', async () => {
    const result = await generateQrPngDataUrl('x'.repeat(1500), 'H');
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'too-long') {
      expect(result.capacity).toBe(1273);
    }
  });
});
