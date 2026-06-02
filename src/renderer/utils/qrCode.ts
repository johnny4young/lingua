/**
 * RL-072 — QR Code generator + decoder helpers.
 *
 * Pure, offline, renderer-side. Wraps `qrcode` (MIT, ~10 KB gzipped,
 * no WASM, no runtime network) for generation and `jsqr` (Apache 2.0,
 * ~50 KB gzipped, pure JS, no WASM) for upload-based decoding. The
 * "camera capture" path is still deferred per the original RL-072
 * scope decision — file upload + drag-drop covers the recognizable
 * QR-reader use case without requesting webcam permission.
 *
 * Contract:
 * - Never throws on invalid input. Helpers return a tagged union
 *   (`{ ok: true, value }` / `{ ok: false, kind, message }`) so the
 *   panel can render an error banner without a try/catch everywhere.
 * - Empty payload is not an "error" — it is the panel's neutral
 *   state and returns `{ ok: false, kind: 'empty' }`.
 * - Oversized payloads return `{ ok: false, kind: 'too-long' }` with
 *   the capacity ceiling the caller can surface in the copy.
 * - Decode failures (no QR found, unreadable image, oversized) all
 *   return their own `kind` discriminators so the renderer copy can
 *   localize without parsing free-form messages.
 */
import jsQR from 'jsqr';

/**
 * RL-125 / AUDIT-05 — `qrcode` is a single-use dependency only the QR generator
 * needs, so it loads on demand via a cached dynamic import instead of shipping
 * inside the Developer Utilities chunk eagerly. The generation helpers are
 * already async, so awaiting the loader adds no caller ripple. (`jsqr`, the
 * decode path, stays static — it sits behind the sync `decodeQrFromImageData`
 * contract and is out of this slice's scope.)
 */
type QrCodeApi = typeof import('qrcode');
let qrCodeModulePromise: Promise<QrCodeApi> | null = null;
function loadQrCode(): Promise<QrCodeApi> {
  // `qrcode` ships as a CommonJS `export =` module; under Vite the dynamic
  // import exposes it on `.default`, while bundler/test interop can also hand
  // back the namespace directly — accept either so types and runtime agree.
  qrCodeModulePromise ??= import('qrcode')
    .then((module) => ((module as { default?: QrCodeApi }).default ?? module) as QrCodeApi)
    .catch((error) => {
      // Drop the cached rejection so a later QR generation can retry instead of
      // permanently failing the session; the caller's try/catch still surfaces
      // this as a tagged-union error.
      qrCodeModulePromise = null;
      throw error;
    });
  return qrCodeModulePromise;
}

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export const QR_ERROR_CORRECTION_LEVELS: readonly QrErrorCorrectionLevel[] = [
  'L',
  'M',
  'Q',
  'H',
] as const;

export type QrGenerationError =
  | { kind: 'empty' }
  | { kind: 'too-long'; capacity: number }
  | { kind: 'unknown'; message: string };

export type QrGenerationResult<T> =
  | { ok: true; value: T }
  | ({ ok: false } & QrGenerationError);

/**
 * Color customization for the rendered QR (folds B + D). The `qrcode`
 * library accepts hex strings (with or without a leading `#`) for both
 * the dark module and the light background. We default to neutral
 * black-on-white because that is the contrast-safest baseline a phone
 * camera + bright sunlight + cheap matte sticker can reliably scan.
 */
export interface QrColorOptions {
  /** Foreground (dark module). Hex with or without leading `#`. */
  dark?: string;
  /** Background (light module). Hex with or without leading `#`. */
  light?: string;
}

export const QR_DEFAULT_DARK = '#000000';
export const QR_DEFAULT_LIGHT = '#ffffff';
/** Pure black on pure white — the high-contrast preset (fold B). */
export const QR_HIGH_CONTRAST_DARK = '#000000';
export const QR_HIGH_CONTRAST_LIGHT = '#ffffff';
/**
 * WCAG-AA contrast ratio threshold. The QR spec itself does not mandate
 * one, but real-world scanners give up well before 4.5:1 — this is the
 * same threshold the WCAG AA guideline uses for normal-size body text,
 * and it lines up empirically with what budget phone cameras can read
 * under indoor lighting.
 */
export const QR_MIN_CONTRAST_RATIO = 4.5;

/**
 * Approximate UTF-8 byte capacities for QR version 40 (the largest
 * standard version) per error-correction level. We use the byte-mode
 * ceiling — the library auto-picks the smallest version that fits the
 * payload, but pre-flight validation catches clearly-too-long inputs
 * before the worker spins up a doomed render.
 *
 * Source: ISO/IEC 18004:2015 Table 7 — byte-mode capacity at version 40.
 */
const BYTE_CAPACITY_BY_LEVEL: Readonly<Record<QrErrorCorrectionLevel, number>> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
};

export function isQrErrorCorrectionLevel(value: unknown): value is QrErrorCorrectionLevel {
  return value === 'L' || value === 'M' || value === 'Q' || value === 'H';
}

export function qrCapacityFor(level: QrErrorCorrectionLevel): number {
  return BYTE_CAPACITY_BY_LEVEL[level];
}

function utf8ByteLength(payload: string): number {
  // TextEncoder is available in jsdom, Chromium, and packaged Electron.
  // Using it sidesteps the surrogate-pair math needed for a manual count.
  return new TextEncoder().encode(payload).length;
}

/**
 * Normalize a user-supplied hex color into the `#rrggbb` form the
 * `qrcode` library accepts. Returns `null` for malformed input so the
 * caller can fall back to the default. Accepts `#rgb`, `rgb`, `#rrggbb`,
 * and `rrggbb` (case-insensitive).
 */
export function normalizeHexColor(input: string | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().replace(/^#/u, '').toLowerCase();
  if (/^[0-9a-f]{3}$/u.test(raw)) {
    const [r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-f]{6}$/u.test(raw)) {
    return `#${raw}`;
  }
  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const slice = normalized.slice(1);
  return {
    r: parseInt(slice.slice(0, 2), 16),
    g: parseInt(slice.slice(2, 4), 16),
    b: parseInt(slice.slice(4, 6), 16),
  };
}

function relativeLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 2.1 contrast ratio between two colors expressed as hex. Returns
 * a number in the range [1, 21]. Falls back to `1` (no contrast) when
 * either input cannot be parsed — that way the panel surfaces the
 * "low contrast" warning instead of silently passing.
 */
export function wcagContrastRatio(
  foreground: string,
  background: string
): number {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) return 1;
  const l1 =
    0.2126 * relativeLuminance(fg.r) +
    0.7152 * relativeLuminance(fg.g) +
    0.0722 * relativeLuminance(fg.b);
  const l2 =
    0.2126 * relativeLuminance(bg.r) +
    0.7152 * relativeLuminance(bg.g) +
    0.0722 * relativeLuminance(bg.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `true` when the foreground/background combination clears the
 * `QR_MIN_CONTRAST_RATIO` bar. Wraps `wcagContrastRatio` so the panel
 * doesn't have to compute the threshold itself.
 */
export function isContrastSafeForQr(
  foreground: string,
  background: string
): boolean {
  return wcagContrastRatio(foreground, background) >= QR_MIN_CONTRAST_RATIO;
}

function resolveColorOptions(
  colors: QrColorOptions | undefined
): { dark: string; light: string } {
  return {
    dark: normalizeHexColor(colors?.dark) ?? QR_DEFAULT_DARK,
    light: normalizeHexColor(colors?.light) ?? QR_DEFAULT_LIGHT,
  };
}

function validatePayload(
  payload: string,
  level: QrErrorCorrectionLevel
): QrGenerationError | null {
  if (payload.length === 0) return { kind: 'empty' };
  const bytes = utf8ByteLength(payload);
  const capacity = qrCapacityFor(level);
  if (bytes > capacity) return { kind: 'too-long', capacity };
  return null;
}

/**
 * Generate an inline SVG string for `payload` at the requested
 * error-correction `level`. Returns a tagged union so the caller
 * can render either the SVG or an error notice.
 *
 * The panel today renders PNG through a standard `<img src>` element
 * so the bundle does not need an HTML sanitizer. The SVG entry point
 * is exposed for the "Download as SVG" action (fold E), where the
 * vector lands in the user's filesystem rather than the live DOM.
 */
export async function generateQrSvg(
  payload: string,
  level: QrErrorCorrectionLevel,
  colors?: QrColorOptions
): Promise<QrGenerationResult<string>> {
  const invalid = validatePayload(payload, level);
  if (invalid) return { ok: false, ...invalid };
  try {
    const QRCode = await loadQrCode();
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      errorCorrectionLevel: level,
      margin: 1,
      color: resolveColorOptions(colors),
    });
    return { ok: true, value: svg };
  } catch (error) {
    return {
      ok: false,
      kind: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate an SVG data URL suitable for an `<a download>` anchor.
 * Same tagged-union contract as `generateQrSvg`. The renderer never
 * inlines the SVG into the DOM; the data URL only flows into the
 * `href` of the download anchor (fold E).
 */
export async function generateQrSvgDataUrl(
  payload: string,
  level: QrErrorCorrectionLevel,
  colors?: QrColorOptions
): Promise<QrGenerationResult<string>> {
  const result = await generateQrSvg(payload, level, colors);
  if (!result.ok) return result;
  // Convert UTF-8 markup → bytes via TextEncoder (modern, lint-clean —
  // `unescape` is deprecated and trips strict-mode harnesses), then
  // base64-encode in chunks because `String.fromCharCode(...bytes)`
  // overflows the V8 spread limit on large SVGs (~64 KiB threshold).
  try {
    const bytes = new TextEncoder().encode(result.value);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    return { ok: true, value: `data:image/svg+xml;base64,${base64}` };
  } catch (error) {
    return {
      ok: false,
      kind: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate a PNG data URL suitable for an `<a download>` anchor.
 * Same tagged-union contract as `generateQrSvg`. We size the PNG to
 * 512 px and request moderate scaling so saved images stay crisp on
 * retina displays without ballooning into multi-MB files.
 */
export async function generateQrPngDataUrl(
  payload: string,
  level: QrErrorCorrectionLevel,
  colors?: QrColorOptions
): Promise<QrGenerationResult<string>> {
  const invalid = validatePayload(payload, level);
  if (invalid) return { ok: false, ...invalid };
  try {
    const QRCode = await loadQrCode();
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: level,
      margin: 1,
      width: 512,
      color: resolveColorOptions(colors),
    });
    return { ok: true, value: dataUrl };
  } catch (error) {
    return {
      ok: false,
      kind: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// ----------------------------------------------------------- Decode mode

export const MAX_DECODE_BYTES = 10 * 1024 * 1024; // 10 MiB cap on uploaded image size.
export const MAX_DECODE_PIXELS = 16_000_000; // 16 MP decoded bitmap cap.

export type QrDecodeError =
  | { kind: 'empty' }
  | { kind: 'too-large'; maxBytes: number }
  | { kind: 'too-many-pixels'; maxPixels: number }
  | { kind: 'unsupported-type' }
  | { kind: 'image-load-failed' }
  | { kind: 'no-qr-found' }
  | { kind: 'unknown'; message: string };

export type QrDecodeResult =
  | { ok: true; value: string }
  | ({ ok: false } & QrDecodeError);

function isImageMimeType(mime: string): boolean {
  // jsqr accepts any pixel data, but we gate on the standard raster
  // formats the browser's `<img>` decoder reliably handles cross-platform.
  return /^image\/(png|jpe?g|webp|gif|bmp)$/iu.test(mime);
}

function validateDecodeDimensions(
  width: number,
  height: number
): QrDecodeError | null {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { kind: 'image-load-failed' };
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_DECODE_PIXELS) {
    return { kind: 'too-many-pixels', maxPixels: MAX_DECODE_PIXELS };
  }
  return null;
}

async function readImageBitmap(
  file: File,
  doc: Document
): Promise<HTMLImageElement> {
  // We intentionally read the file as a `data:` URL (via FileReader)
  // rather than minting a `blob:` URL with `URL.createObjectURL`. The
  // renderer's Content-Security-Policy ships `img-src 'self' data:`
  // — allowing `blob:` would widen the policy site-wide just for this
  // panel, while the data-URL path costs nothing in performance for
  // the 10 MiB cap we already enforce upstream. Caught by the dev
  // smoke for RL-072.
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('image-load-failed'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error('image-load-failed'));
    reader.readAsDataURL(file);
  });
  return await new Promise((resolve, reject) => {
    const image = doc.createElement('img');
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-load-failed'));
    image.src = dataUrl;
  });
}

function imageToImageData(
  image: HTMLImageElement,
  doc: Document
): ImageData | null {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width === 0 || height === 0) return null;
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  try {
    return ctx.getImageData(0, 0, width, height);
  } catch {
    // Tainted canvas (cross-origin) should never hit for data URLs read
    // from the user's local file, but guard for safety.
    return null;
  }
}

/**
 * Decode a QR code from an uploaded image. Returns the embedded payload
 * string on success, or a typed error variant the renderer can localize.
 *
 * Accepts the file plus an optional `Document` for testability — jsdom
 * tests pass their own canvas-rendered ImageData via `decodeQrFromImageData`
 * directly.
 */
export async function decodeQrFromFile(
  file: File | null,
  doc: Document = document
): Promise<QrDecodeResult> {
  if (!file) return { ok: false, kind: 'empty' };
  if (file.size > MAX_DECODE_BYTES) {
    return { ok: false, kind: 'too-large', maxBytes: MAX_DECODE_BYTES };
  }
  if (file.type && !isImageMimeType(file.type)) {
    return { ok: false, kind: 'unsupported-type' };
  }

  let image: HTMLImageElement;
  try {
    image = await readImageBitmap(file, doc);
  } catch {
    return { ok: false, kind: 'image-load-failed' };
  }

  const dimensionError = validateDecodeDimensions(image.naturalWidth, image.naturalHeight);
  if (dimensionError) return { ok: false, ...dimensionError };
  const data = imageToImageData(image, doc);
  if (!data) return { ok: false, kind: 'image-load-failed' };
  return decodeQrFromImageData(data);
}

/**
 * Decode pre-rasterized ImageData. Exposed for tests + future callers
 * (e.g. paste-image-from-clipboard) so `decodeQrFromFile` is not the
 * only entry point.
 */
export function decodeQrFromImageData(data: ImageData): QrDecodeResult {
  try {
    const dimensionError = validateDecodeDimensions(data.width, data.height);
    if (dimensionError) return { ok: false, ...dimensionError };
    const decoded = jsQR(data.data, data.width, data.height);
    if (!decoded) return { ok: false, kind: 'no-qr-found' };
    return { ok: true, value: decoded.data };
  } catch (error) {
    return {
      ok: false,
      kind: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// ------------------------------------------------------- Copy-as-PNG (fold C)

export type CopyPngResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'permission-denied' | 'unknown'; message?: string };

function dataUrlToBlob(dataUrl: string): Blob {
  // Decode synchronously via atob — fetching the data URL would trip the
  // renderer's CSP `connect-src 'self' https://licenses… https://updates…`
  // directive (data: is not on the allowlist), so every Copy-as-PNG would
  // fall through to the "unknown" failure branch in production. The
  // synchronous path also sidesteps the cost of routing a 30–80 KB PNG
  // through the Fetch pipeline.
  const commaIndex = dataUrl.indexOf(',');
  const header = commaIndex === -1 ? '' : dataUrl.slice(0, commaIndex);
  const base64 = commaIndex === -1 ? '' : dataUrl.slice(commaIndex + 1);
  const mime = header.match(/:(.*?);/u)?.[1] ?? 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * Copy a PNG data URL to the system clipboard as an `image/png` blob,
 * not as a string. Lets users paste the QR into Slack / email / Notion
 * as a real raster image. Falls back gracefully when
 * `navigator.clipboard.write` or `ClipboardItem` is missing — the
 * renderer surfaces an "unsupported, use Download instead" notice.
 */
export async function copyPngDataUrlToClipboard(
  dataUrl: string
): Promise<CopyPngResult> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== 'function' ||
    typeof ClipboardItem === 'undefined'
  ) {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    const blob = dataUrlToBlob(dataUrl);
    const item = new ClipboardItem({ [blob.type || 'image/png']: blob });
    await navigator.clipboard.write([item]);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|denied/iu.test(message)) {
      return { ok: false, reason: 'permission-denied', message };
    }
    return { ok: false, reason: 'unknown', message };
  }
}
