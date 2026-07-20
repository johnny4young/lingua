/**
 * implementation detail — pure clipboard-image extraction for the
 * ConsolePanel paste path.
 *
 * The rich-media OUTPUT renderer (`<RichValueImage>`) shipped in implementation
 * 2a; this is the INPUT counterpart. The logic lives here (not inline
 * in the component) so the size cap + type checks + the discriminated
 * result are unit-testable without a real clipboard or a mounted
 * ConsolePanel.
 *
 * Privacy posture: the image never leaves the renderer — it becomes an
 * in-memory `data:image/...` base64 console entry, validated through
 * the same `validateImageSrc` whitelist (`data:image/` only, no remote
 * fetch) the worker rich-media path uses. Telemetry carries only a
 * closed-enum status + size bucket, never the bytes.
 */

import { validateImageSrc } from '../../../shared/richOutput';

/**
 * Hard cap on a pasted image's decoded byte size. 2 MiB keeps a single
 * paste from ballooning the in-memory console-entry ring (the base64
 * data URI inflates ~33%, still well under `MAX_IMAGE_SRC_LENGTH`).
 */
export const MAX_PASTED_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Outcome of reading an image from a paste gesture.
 *
 * - `ok: true` carries the validated `data:image/...` URI ready to drop
 *   into a `RichOutputImage` payload, its MIME, and the decoded byte
 *   length (used for the telemetry size bucket). `resized: true` means
 *   the source exceeded `MAX_PASTED_IMAGE_BYTES` and was downscaled to
 *   fit — `byteLength` is then the POST-resize size, so the
 *   telemetry bucket reflects what actually landed in the console.
 * - `ok: false` carries a closed reason:
 *   - `no-image` — the clipboard had no image item; the caller should
 *     let the default (text) paste proceed and emit NO telemetry.
 *   - `too-large` — the image exceeded `MAX_PASTED_IMAGE_BYTES` AND the
 *     downscale could not get it under the cap.
 *   - `unreadable` — the File read threw, or the resulting data URI
 *     failed `validateImageSrc`.
 */
export type ClipboardImageResult =
  | {
      ok: true;
      dataUri: string;
      mime: string;
      byteLength: number;
      resized?: boolean;
    }
  | { ok: false; reason: 'no-image' }
  | { ok: false; reason: 'too-large' | 'unreadable'; byteLength: number };

/**
 * A successfully downscaled image: the validated `data:image/...` URI, its
 * (possibly re-encoded) MIME, and the decoded byte length AFTER resize.
 */
export interface ResizedImage {
  readonly dataUri: string;
  readonly mime: string;
  readonly byteLength: number;
}

/**
 * Pull the first image File out of a `DataTransfer` (the
 * `event.clipboardData` of a paste). Returns `null` when no image is
 * present so the caller can fall through to the browser's default text
 * paste. Pure + synchronous so tests can pass a synthetic
 * `DataTransfer`.
 */
export function extractClipboardImageFile(
  data: DataTransfer | null | undefined
): File | null {
  if (!data) return null;
  // `items` is the richer surface (covers screenshot pastes that never
  // hit `files`); fall back to `files` for browsers that only populate
  // the legacy list.
  const items = data.items;
  if (items && items.length > 0) {
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  const files = data.files;
  if (files && files.length > 0) {
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) return file;
    }
  }
  return null;
}

/** Longest edge (px) the first downscale attempt targets. */
const MAX_RESIZE_DIMENSION = 1600;
/** Floor edge (px); below this we stop shrinking and give up. */
const MIN_RESIZE_DIMENSION = 320;
/** Bounded retry count so a pathological image can never loop forever. */
const MAX_RESIZE_ATTEMPTS = 6;
/** JPEG quality for the opaque re-encode path (implementation note). */
const RESIZE_JPEG_QUALITY = 0.82;
/** Edge (px) of the cheap opacity probe (implementation note). */
const ALPHA_PROBE_SIZE = 256;

/** Source MIME types that might carry transparency. JPEG / BMP cannot. */
function sourceMightHaveAlpha(mime: string): boolean {
  const normalized = mime.toLowerCase();
  // Only known non-alpha raster formats skip the probe. Clipboard files can
  // occasionally arrive with an empty or unusual image/* MIME (for example
  // SVG), so unknown image types stay conservative and are probed.
  return (
    normalized !== 'image/jpeg' &&
    normalized !== 'image/jpg' &&
    normalized !== 'image/bmp'
  );
}

/**
 * Cheap opacity probe (implementation note): draw the bitmap into a small
 * `ALPHA_PROBE_SIZE`² canvas and scan its alpha channel. Any pixel < 255
 * means the image carries transparency, so it must stay PNG (JPEG would
 * flatten alpha to black).
 *
 * `imageSmoothingEnabled = false` makes the downscale a nearest-neighbor
 * SAMPLE, not a blend — so a transparent pixel can never be averaged into
 * an opaque one and silently misclassified (the blend would flatten that
 * region to black under JPEG). The residual is a pure sampling limit: a
 * transparency region smaller than the source stride (≈ srcEdge /
 * `ALPHA_PROBE_SIZE` px) may not be sampled, in which case the image
 * re-encodes to JPEG and loses that sub-stride transparency — an
 * acceptable trade for a >2 MiB paste-to-console convenience. On any
 * canvas failure we conservatively report "not opaque" so the caller
 * keeps PNG.
 */
function isBitmapOpaque(bitmap: ImageBitmap): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = ALPHA_PROBE_SIZE;
    canvas.height = ALPHA_PROBE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, ALPHA_PROBE_SIZE, ALPHA_PROBE_SIZE);
    const { data } = ctx.getImageData(0, 0, ALPHA_PROBE_SIZE, ALPHA_PROBE_SIZE);
    for (let i = 3; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 255) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Re-encode the bitmap at `w`x`h` to a data URI; `null` on canvas failure. */
function encodeBitmap(
  bitmap: ImageBitmap,
  w: number,
  h: number,
  mime: string,
  quality: number | undefined
): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL(mime, quality);
  } catch {
    return null;
  }
}

/**
 * Decoded byte length of a base64 data URI. EXACT (not an estimate) for
 * the canvas output we feed it: `canvas.toDataURL` always emits standard
 * padded base64 whose length is a multiple of 4, so `len*3/4 - padding`
 * is the precise decoded size — the same decoded-byte unit as `file.size`
 * that the cap is compared against.
 */
function dataUriByteLength(dataUri: string): number {
  const comma = dataUri.indexOf(',');
  const b64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Downscale an over-cap image until it fits under `maxBytes`.
 * Opaque images re-encode to JPEG (much smaller); images with alpha stay
 * PNG (implementation note). DOM-dependent (`createImageBitmap` + `<canvas>`), so it is
 * exercised in the Chromium e2e, not jsdom — `readPastedImageFile` takes
 * it as an injectable param so the orchestration stays unit-testable.
 * Never throws; returns `null` when it cannot fit the cap or decode fails.
 */
export async function resizeImageToFit(
  file: File,
  maxBytes: number
): Promise<ResizedImage | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const opaque = !sourceMightHaveAlpha(file.type) || isBitmapOpaque(bitmap);
    const mime = opaque ? 'image/jpeg' : 'image/png';
    const quality = opaque ? RESIZE_JPEG_QUALITY : undefined;
    const longestEdge = Math.max(bitmap.width, bitmap.height) || 1;
    let scale = Math.min(1, MAX_RESIZE_DIMENSION / longestEdge);

    for (let attempt = 0; attempt < MAX_RESIZE_ATTEMPTS; attempt += 1) {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const dataUri = encodeBitmap(bitmap, w, h, mime, quality);
      if (dataUri === null) return null;
      const byteLength = dataUriByteLength(dataUri);
      if (byteLength <= maxBytes) {
        const validated = validateImageSrc(dataUri);
        return validated ? { dataUri: validated, mime, byteLength } : null;
      }
      if (Math.max(w, h) <= MIN_RESIZE_DIMENSION) break;
      scale *= 0.8;
    }
    return null;
  } catch {
    return null;
  } finally {
    try {
      bitmap.close();
    } catch {
      // Best-effort cleanup only; resizeImageToFit must never reject.
    }
  }
}

/**
 * Read an image File into a validated data URI, enforcing the 2 MiB
 * cap. Async because it reads the blob through `FileReader`. Never
 * throws — read failures resolve to `{ ok: false, reason: 'unreadable' }`.
 *
 * `resize` is injectable purely as a unit-test seam (the real
 * `resizeImageToFit` needs a DOM canvas the jsdom suite lacks); callers
 * leave it at the default.
 */
export async function readPastedImageFile(
  file: File,
  resize: (
    file: File,
    maxBytes: number
  ) => Promise<ResizedImage | null> = resizeImageToFit
): Promise<ClipboardImageResult> {
  if (file.size > MAX_PASTED_IMAGE_BYTES) {
    // Most real pastes (screenshots) exceed the cap — downscale to fit
    // instead of rejecting. Fall back to `too-large` only when the resize
    // cannot get under the cap.
    let resized: ResizedImage | null;
    try {
      resized = await resize(file, MAX_PASTED_IMAGE_BYTES);
    } catch {
      resized = null;
    }
    if (resized) {
      return {
        ok: true,
        dataUri: resized.dataUri,
        mime: resized.mime,
        byteLength: resized.byteLength,
        resized: true,
      };
    }
    return { ok: false, reason: 'too-large', byteLength: file.size };
  }
  let dataUri: string;
  try {
    dataUri = await readFileAsDataUrl(file);
  } catch {
    return { ok: false, reason: 'unreadable', byteLength: file.size };
  }
  const validated = validateImageSrc(dataUri);
  if (!validated) {
    return { ok: false, reason: 'unreadable', byteLength: file.size };
  }
  return {
    ok: true,
    dataUri: validated,
    mime: file.type || 'image/png',
    byteLength: file.size,
  };
}

/**
 * Convenience composite: extract the first clipboard image and read it.
 * Returns `{ ok: false, reason: 'no-image' }` (telemetry-silent) when
 * the clipboard carries no image.
 */
export async function readClipboardImage(
  data: DataTransfer | null | undefined
): Promise<ClipboardImageResult> {
  const file = extractClipboardImageFile(data);
  if (!file) return { ok: false, reason: 'no-image' };
  return readPastedImageFile(file);
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('unexpected reader result'));
    };
    reader.readAsDataURL(file);
  });
}
