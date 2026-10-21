/**
 * How the value viewer shows one cell: JSON pretty-printed, a BLOB as an
 * image (when its bytes say so), hex and size, or long text in full. BLOBs
 * reach the renderer as base64 (see `sanitiseValueForJson`).
 */

export type SqlCellView =
  | { kind: 'null' }
  | { kind: 'json'; pretty: string }
  | { kind: 'blob'; bytes: Uint8Array; mime: string | null }
  | { kind: 'text'; text: string };

const IMAGE_SIGNATURES: ReadonlyArray<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
];

export function sniffImage(bytes: Uint8Array): string | null {
  return (
    IMAGE_SIGNATURES.find(({ bytes: sig, offset = 0 }) => sig.every((byte, i) => bytes[offset + i] === byte))?.mime ?? null
  );
}

function decodeBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function prettyJson(value: unknown): string | null {
  try {
    return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner), 2);
  } catch {
    return null;
  }
}

export function viewCell(value: unknown, duckType: string): SqlCellView {
  if (value === null || value === undefined) return { kind: 'null' };
  if (duckType === 'BLOB' && typeof value === 'string') {
    const bytes = decodeBase64(value);
    if (bytes) return { kind: 'blob', bytes, mime: sniffImage(bytes) };
  }
  if (typeof value === 'object') {
    const pretty = prettyJson(value);
    if (pretty !== null) return { kind: 'json', pretty };
  }
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try {
      const pretty = prettyJson(JSON.parse(value));
      if (pretty !== null) return { kind: 'json', pretty };
    } catch {
      /* not JSON after all; show the text */
    }
  }
  return { kind: 'text', text: typeof value === 'string' ? value : String(value) };
}

/** Offset, 16 hex bytes and their ASCII per line, for the first `limit` bytes. */
export function hexDump(bytes: Uint8Array, limit = 512): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, limit); offset += 16) {
    const chunk = Array.from(bytes.subarray(offset, Math.min(offset + 16, bytes.length, limit)));
    const hex = chunk.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const ascii = chunk.map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

export function formatByteSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
