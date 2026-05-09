import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QR_ERROR_CORRECTION_LEVELS,
  QR_MIN_CONTRAST_RATIO,
  MAX_DECODE_PIXELS,
  copyPngDataUrlToClipboard,
  decodeQrFromFile,
  decodeQrFromImageData,
  generateQrPngDataUrl,
  generateQrSvg,
  generateQrSvgDataUrl,
  isContrastSafeForQr,
  isQrErrorCorrectionLevel,
  normalizeHexColor,
  qrCapacityFor,
  wcagContrastRatio,
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

// ----------------------------------------------------------- Decode mode

describe("decodeQrFromImageData", () => {
  it("returns no-qr-found for an unstructured ImageData blob", () => {
    // jsdom does not implement the ImageData constructor; the helper
    // only reads `data`, `width`, and `height`, so a structural mock
    // is enough to exercise the no-QR branch end-to-end.
    const data = {
      data: new Uint8ClampedArray(4 * 16 * 16),
      width: 16,
      height: 16,
      colorSpace: "srgb" as const,
    } as ImageData;
    expect(decodeQrFromImageData(data)).toEqual({
      ok: false,
      kind: "no-qr-found",
    });
  });

  it("rejects decoded bitmaps above the safe pixel cap before calling jsqr", () => {
    const data = {
      data: new Uint8ClampedArray(4),
      width: MAX_DECODE_PIXELS + 1,
      height: 1,
      colorSpace: "srgb" as const,
    } as ImageData;
    expect(decodeQrFromImageData(data)).toEqual({
      ok: false,
      kind: "too-many-pixels",
      maxPixels: MAX_DECODE_PIXELS,
    });
  });
});

describe("decodeQrFromFile", () => {
  it("returns empty when no file is provided", async () => {
    const result = await decodeQrFromFile(null);
    expect(result).toEqual({ ok: false, kind: "empty" });
  });

  it("rejects non-image MIME types", async () => {
    const file = new File(["fake"], "doc.pdf", { type: "application/pdf" });
    const result = await decodeQrFromFile(file);
    expect(result).toEqual({ ok: false, kind: "unsupported-type" });
  });

  it("rejects oversized images", async () => {
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.png", {
      type: "image/png",
    });
    const result = await decodeQrFromFile(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("too-large");
  });

  it("returns image-load-failed when the FileReader rejects the bytes", async () => {
    // Stub FileReader so its `onerror` fires synchronously. The previous
    // version of this test fed corrupt PNG bytes through the blob URL +
    // `<img>.onerror` path, but the helper now reads via `readAsDataURL`
    // (renderer CSP ships `img-src 'self' data:`, no blob:). Driving the
    // failure via the FileReader keeps the test deterministic regardless
    // of jsdom's `<img>` decoding semantics.
    const original = globalThis.FileReader;
    class FailingFileReader {
      result: string | null = null;
      onload: ((this: unknown) => void) | null = null;
      onerror: ((this: unknown) => void) | null = null;
      readAsDataURL() {
        // Match the real API by deferring to a microtask before firing.
        Promise.resolve().then(() => this.onerror?.call(this));
      }
    }
    (globalThis as unknown as { FileReader: typeof FileReader }).FileReader =
      FailingFileReader as unknown as typeof FileReader;
    try {
      const corrupt = new File([new Uint8Array([0, 1, 2, 3])], "broken.png", {
        type: "image/png",
      });
      const result = await decodeQrFromFile(corrupt);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("image-load-failed");
    } finally {
      (globalThis as unknown as { FileReader: typeof FileReader }).FileReader =
        original;
    }
  });
});

describe("copyPngDataUrlToClipboard", () => {
  let originalClipboard: typeof navigator.clipboard | undefined;
  let originalClipboardItem: typeof globalThis.ClipboardItem | undefined;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalClipboardItem = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    } else {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    }
    (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem = originalClipboardItem;
  });

  it("returns unsupported when ClipboardItem is missing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    delete (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    const result = await copyPngDataUrlToClipboard("data:image/png;base64,abc");
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });

  it("writes a ClipboardItem when the API is available", async () => {
    const writeSpy = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: writeSpy },
    });
    class FakeClipboardItem {
      constructor(public readonly entries: Record<string, Blob>) {}
    }
    (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem =
      FakeClipboardItem as unknown as typeof ClipboardItem;
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";
    const result = await copyPngDataUrlToClipboard(dataUrl);
    expect(result.ok).toBe(true);
    expect(writeSpy).toHaveBeenCalledOnce();
  });

  it("classifies permission-denied separately from unknown failures", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: vi.fn(async () => {
          throw new Error("Permission denied by user");
        }),
      },
    });
    class FakeClipboardItem {}
    (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem =
      FakeClipboardItem as unknown as typeof ClipboardItem;
    const result = await copyPngDataUrlToClipboard("data:image/png;base64,abc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("permission-denied");
  });
});

// ----------------------------------------------------------- Color + contrast

describe('normalizeHexColor', () => {
  it('accepts the four standard hex shapes and lower-cases the output', () => {
    expect(normalizeHexColor('#FFFFFF')).toBe('#ffffff');
    expect(normalizeHexColor('ffffff')).toBe('#ffffff');
    expect(normalizeHexColor('#fff')).toBe('#ffffff');
    expect(normalizeHexColor('Fff')).toBe('#ffffff');
  });

  it('rejects anything that is not a 3- or 6-digit hex string', () => {
    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor(undefined)).toBeNull();
    expect(normalizeHexColor('#ff')).toBeNull();
    expect(normalizeHexColor('#ggg')).toBeNull();
    expect(normalizeHexColor('rgb(0,0,0)')).toBeNull();
    expect(normalizeHexColor('#1234567')).toBeNull();
  });
});

describe('wcagContrastRatio', () => {
  it('returns the textbook 21:1 for pure black on pure white', () => {
    const ratio = wcagContrastRatio('#000000', '#ffffff');
    // The textbook value is 21 exactly. Allow a hair for floating-point.
    expect(ratio).toBeGreaterThan(20.99);
    expect(ratio).toBeLessThan(21.01);
  });

  it('returns 1 when either color cannot be parsed (fail-loud)', () => {
    expect(wcagContrastRatio('not-a-color', '#ffffff')).toBe(1);
    expect(wcagContrastRatio('#000000', 'rgb(0,0,0)')).toBe(1);
  });

  it('flags low-contrast pairs (yellow on white) below 4.5:1', () => {
    // Yellow on white is the canonical "looks fine, scans terribly" case.
    const ratio = wcagContrastRatio('#ffff00', '#ffffff');
    expect(ratio).toBeLessThan(QR_MIN_CONTRAST_RATIO);
  });
});

describe('isContrastSafeForQr', () => {
  it('passes the high-contrast preset', () => {
    expect(isContrastSafeForQr('#000000', '#ffffff')).toBe(true);
  });

  it('rejects yellow-on-white and white-on-white', () => {
    expect(isContrastSafeForQr('#ffff00', '#ffffff')).toBe(false);
    expect(isContrastSafeForQr('#ffffff', '#ffffff')).toBe(false);
  });
});

describe('generateQrSvg with custom colors', () => {
  it('embeds the requested foreground hex into the SVG markup', async () => {
    const result = await generateQrSvg('hola', 'M', {
      dark: '#1a73e8',
      light: '#ffffff',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // qrcode emits hex (lowercased) for both modules. We only assert
      // the dark module since the light one defaults to white in the
      // CSS path qrcode itself emits.
      expect(result.value.toLowerCase()).toContain('#1a73e8');
    }
  });

  it('falls back to the default colors on invalid hex input', async () => {
    const result = await generateQrSvg('hola', 'M', {
      dark: 'not-a-color',
      light: 'rgb(0,0,0)',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Default dark = #000000; the SVG should mention it somewhere.
      expect(result.value.toLowerCase()).toContain('#000000');
    }
  });
});

describe('generateQrSvgDataUrl', () => {
  it('returns a base64 SVG data URL for a valid payload', async () => {
    const result = await generateQrSvgDataUrl('lingua', 'M');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('data:image/svg+xml;base64,')).toBe(true);
      const base64 = result.value.slice('data:image/svg+xml;base64,'.length);
      // Decode and confirm we round-trip back to a valid SVG.
      const decoded = atob(base64);
      expect(decoded.startsWith('<svg')).toBe(true);
      expect(decoded.trim().endsWith('</svg>')).toBe(true);
    }
  });

  it('shares the empty-payload discriminator with the SVG helper', async () => {
    const result = await generateQrSvgDataUrl('', 'M');
    expect(result).toEqual({ ok: false, kind: 'empty' });
  });

  it('round-trips emoji payloads through UTF-8 base64 without corruption', async () => {
    // Emoji are >1 byte in UTF-8, which would crash `btoa` directly.
    // The helper must convert via encodeURIComponent first.
    const result = await generateQrSvgDataUrl('hola 👋🏽 mundo', 'M');
    expect(result.ok).toBe(true);
  });
});

describe('generateQrPngDataUrl with custom colors', () => {
  it('still returns a PNG data URL when custom colors are passed', async () => {
    const result = await generateQrPngDataUrl('lingua', 'M', {
      dark: '#1a73e8',
      light: '#fafafa',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('data:image/png;base64,')).toBe(true);
    }
  });
});
