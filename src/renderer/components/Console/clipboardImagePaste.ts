/**
 * RL-044 next slice — pure clipboard-image extraction for the
 * ConsolePanel paste path.
 *
 * The rich-media OUTPUT renderer (`<RichValueImage>`) shipped in Slice
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
 *   length (used for the telemetry size bucket).
 * - `ok: false` carries a closed reason:
 *   - `no-image` — the clipboard had no image item; the caller should
 *     let the default (text) paste proceed and emit NO telemetry.
 *   - `too-large` — the image exceeded `MAX_PASTED_IMAGE_BYTES`.
 *   - `unreadable` — the File read threw, or the resulting data URI
 *     failed `validateImageSrc`.
 */
export type ClipboardImageResult =
  | { ok: true; dataUri: string; mime: string; byteLength: number }
  | { ok: false; reason: 'no-image' }
  | { ok: false; reason: 'too-large' | 'unreadable'; byteLength: number };

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

/**
 * Read an image File into a validated data URI, enforcing the 2 MiB
 * cap. Async because it reads the blob through `FileReader`. Never
 * throws — read failures resolve to `{ ok: false, reason: 'unreadable' }`.
 */
export async function readPastedImageFile(
  file: File
): Promise<ClipboardImageResult> {
  if (file.size > MAX_PASTED_IMAGE_BYTES) {
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
