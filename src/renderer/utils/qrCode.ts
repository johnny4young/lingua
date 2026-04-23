/**
 * RL-072 — QR Code generator helper.
 *
 * Pure, offline, renderer-side. Wraps the `qrcode` npm package (MIT,
 * ~10 KB gzipped, no WASM, no runtime network) and exposes two
 * production surfaces: an SVG string for inline preview, and a PNG
 * data URL for Download-as-PNG. Read mode (decode a scanned image)
 * is deliberately out of this slice — see `RL-072` in ROADMAP §4e
 * for the open "camera vs upload" decision.
 *
 * Contract:
 * - Never throws on invalid input. Helpers return a tagged union
 *   (`{ ok: true, value }` / `{ ok: false, kind, message }`) so the
 *   panel can render an error banner without a try/catch everywhere.
 * - Empty payload is not an "error" — it is the panel's neutral
 *   state and returns `{ ok: false, kind: 'empty' }`.
 * - Oversized payloads return `{ ok: false, kind: 'too-long' }` with
 *   the capacity ceiling the caller can surface in the copy.
 */
import QRCode from 'qrcode';

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
 * Not consumed by QrCodePanel today — the panel renders PNG via
 * `<img src>` to sidestep DOMPurify. Kept exported (with full test
 * coverage) as the canonical entry point for any future "copy SVG"
 * action, printable-sticker export, or docs-site embed.
 */
export async function generateQrSvg(
  payload: string,
  level: QrErrorCorrectionLevel
): Promise<QrGenerationResult<string>> {
  const invalid = validatePayload(payload, level);
  if (invalid) return { ok: false, ...invalid };
  try {
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      errorCorrectionLevel: level,
      margin: 1,
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
 * Generate a PNG data URL suitable for an `<a download>` anchor.
 * Same tagged-union contract as `generateQrSvg`. We size the PNG to
 * 512 px and request moderate scaling so saved images stay crisp on
 * retina displays without ballooning into multi-MB files.
 */
export async function generateQrPngDataUrl(
  payload: string,
  level: QrErrorCorrectionLevel
): Promise<QrGenerationResult<string>> {
  const invalid = validatePayload(payload, level);
  if (invalid) return { ok: false, ...invalid };
  try {
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: level,
      margin: 1,
      width: 512,
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
