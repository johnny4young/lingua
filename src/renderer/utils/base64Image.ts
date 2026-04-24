/**
 * RL-071 — Base64 Image Encode / Decode helper.
 *
 * Pure, offline, renderer-side. Two entry points:
 *
 *   - `encodeFileToDataUri(file)` — read a `File` (from a drag-drop or
 *     `<input type="file">`) and resolve to `data:<mime>;base64,<payload>`.
 *     Rejects non-image MIME and oversized files up front so the panel
 *     can surface a translated error without touching the file bytes.
 *
 *   - `decodeDataUri(value)` — parse a pasted `data:` URI string,
 *     validate that it claims an image MIME, decode the base64 payload
 *     size, and return a tagged-union result the panel can render as a
 *     preview + metadata row.
 *
 * No network, no IPC, no FileSystem API — only the standard browser
 * `File` / `FileReader` / `atob` / `btoa` set, which means the module
 * runs identically in Electron's Chromium renderer, the web build, and
 * vitest's jsdom setup.
 */

/** Upper bound on file size a user can encode without warning. 10 MB. */
export const BASE64_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export type Base64ImageEncodeResult =
  | { ok: true; dataUri: string; mime: string; byteSize: number }
  | { ok: false; kind: 'not-image'; mime: string }
  | { ok: false; kind: 'too-large'; byteSize: number; maxBytes: number }
  | { ok: false; kind: 'read-error'; message: string };

export type Base64ImageDecodeResult =
  | { ok: true; dataUri: string; mime: string; byteSize: number }
  | { ok: false; kind: 'invalid-uri' }
  | { ok: false; kind: 'not-image'; mime: string }
  | { ok: false; kind: 'invalid-base64'; message: string };

/**
 * Encode a `File` to its `data:` URI form. Returns a tagged-union
 * result — the caller never has to wrap this in a try/catch because
 * every failure mode is enumerated.
 */
export function encodeFileToDataUri(file: File): Promise<Base64ImageEncodeResult> {
  return new Promise((resolve) => {
    const mime = file.type;
    if (!mime.startsWith('image/')) {
      resolve({ ok: false, kind: 'not-image', mime });
      return;
    }
    if (file.size > BASE64_IMAGE_MAX_BYTES) {
      resolve({
        ok: false,
        kind: 'too-large',
        byteSize: file.size,
        maxBytes: BASE64_IMAGE_MAX_BYTES,
      });
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      const message = reader.error?.message ?? 'FileReader failed';
      resolve({ ok: false, kind: 'read-error', message });
    };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        resolve({ ok: false, kind: 'read-error', message: 'Expected string result' });
        return;
      }
      resolve({
        ok: true,
        dataUri: result,
        mime,
        byteSize: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

const DATA_URI_PREFIX = /^data:(?<mime>[^;,]+)(?<params>;[^,]*)?,(?<body>.*)$/s;

/**
 * Parse a pasted `data:` URI into a `{ dataUri, mime, byteSize }`
 * descriptor. Validates that the MIME type claims an image family and
 * that the base64 payload decodes cleanly. Tagged-union errors let the
 * panel translate each failure mode to localized copy.
 */
export function decodeDataUri(value: string): Base64ImageDecodeResult {
  const trimmed = value.trim();
  const match = trimmed.match(DATA_URI_PREFIX);
  if (!match) return { ok: false, kind: 'invalid-uri' };

  const mime = match.groups?.['mime']?.trim() ?? '';
  const params = match.groups?.['params'] ?? '';
  const body = match.groups?.['body'] ?? '';
  const isBase64 = /(^|;)\s*base64\s*(;|$)/i.test(params);

  if (!mime.toLowerCase().startsWith('image/')) {
    return { ok: false, kind: 'not-image', mime };
  }

  let byteSize: number;
  try {
    if (isBase64) {
      byteSize = atob(body).length;
    } else {
      // Non-base64 body is percent-encoded text (e.g. SVG). The byte
      // size is the decoded UTF-8 length.
      byteSize = new TextEncoder().encode(decodeURIComponent(body)).byteLength;
    }
  } catch (error) {
    return {
      ok: false,
      kind: 'invalid-base64',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return { ok: true, dataUri: trimmed, mime, byteSize };
}

/**
 * Format a byte count as a human-friendly string for the metadata
 * row. Intentionally simple — the panel shows approximate sizes, not
 * exact file system accounting.
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
