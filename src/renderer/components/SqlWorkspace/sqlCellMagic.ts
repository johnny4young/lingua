import { validateImageSrc } from '../../../shared/richOutput';
import { sniffImage } from './sqlCellValue';

/** How a cell draws beyond its text. */
export type SqlCellMagic = { kind: 'link'; href: string; host: string } | { kind: 'bar'; value: number } | { kind: 'check'; on: boolean } | { kind: 'image'; src: string };

const URL_CHARS = 2048;
/** Base64 length of about 300 KB of bytes, plenty for a 20 px thumbnail; a bigger image stays text. */
const THUMB_BASE64_CHARS = 400_000;
const THUMB_MAX_SIDE = 4096;
const IMAGE_HEADER_BASE64_CHARS = 40;
// A JPEG states its size after its metadata segments, so read further into it.
const JPEG_HEADER_BASE64_CHARS = 87_384;
const RASTER_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
// Control, bidi and zero-width characters could disguise where a link goes.
const DISGUISING_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const HTTP_URL = /^https?:\/\/[^\s<>"]+$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Numeric columns drawn as 0–1 bars: every loaded value is a number from 0
 * to 1 and at least one has a fraction, so a column of 0s and 1s stays numbers.
 */
export function fractionColumns(
  columns: ReadonlyArray<{ name: string; numeric: boolean }>,
  rows: ReadonlyArray<Record<string, unknown>>
): ReadonlySet<string> {
  // Row by row: rows are hash tables scattered over the heap, so a column at a time misses the cache on every cell.
  const open = columns.filter(({ numeric }) => numeric).map(({ name }) => ({ name, fractional: false }));
  let openCount = open.length;
  for (const row of rows) {
    if (openCount === 0) break;
    let kept = 0;
    for (let index = 0; index < openCount; index++) {
      const column = open[index]!;
      const value = row[column.name];
      if (value !== null && value !== undefined) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) continue;
        if (!Number.isInteger(value)) column.fractional = true;
      }
      open[kept++] = column;
    }
    openCount = kept;
  }
  return new Set(open.slice(0, openCount).filter(({ fractional }) => fractional).map(({ name }) => name));
}

/** Width and height from the image's header, or null when the header does not state them. */
function imageSize(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const u16le = (at: number) => bytes[at]! | (bytes[at + 1]! << 8);
  const u16be = (at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
  const u24le = (at: number) => u16le(at) | (bytes[at + 2]! << 16);
  const u32be = (at: number) => u16be(at) * 65536 + u16be(at + 2);
  const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  if (mime === 'image/png') return size(u32be(16), u32be(20));
  if (mime === 'image/gif') return size(u16le(6), u16le(8));
  if (mime === 'image/webp') {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') return size(u24le(24) + 1, u24le(27) + 1);
    if (chunk === 'VP8 ') return size(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    if (chunk === 'VP8L') return size(1 + (u16le(21) & 0x3fff), 1 + ((u24le(22) >> 6) & 0x3fff));
    return null;
  }
  let at = 2;
  while (at + 9 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return size(u16be(at + 7), u16be(at + 5));
    }
    at += 2 + u16be(at + 2);
  }
  return null;
}

function decodePrefix(base64: string, chars: number): Uint8Array {
  return Uint8Array.from(atob(base64.slice(0, chars)), char => char.charCodeAt(0));
}

/** A compressed image can be small in bytes and huge once decoded, so its stated size must fit too. */
function fitsThumbnail(base64: string, mime: string): boolean {
  const bytes = decodePrefix(base64, mime === 'image/jpeg' ? JPEG_HEADER_BASE64_CHARS : IMAGE_HEADER_BASE64_CHARS);
  const size = imageSize(bytes, mime);
  return size !== null && size.width <= THUMB_MAX_SIDE && size.height <= THUMB_MAX_SIDE;
}

function dataUrlFitsThumbnail(value: string): boolean {
  try {
    const mime = value.slice('data:'.length, value.indexOf(';'));
    return fitsThumbnail(value.slice(value.indexOf(',') + 1), mime);
  } catch {
    return false;
  }
}

/** BLOBs arrive as base64, so only the first bytes are decoded to name the image and the value becomes the data URL as is. */
function blobImage(value: string): string | null {
  if (value.length > THUMB_BASE64_CHARS || !BASE64.test(value)) return null;
  try {
    const mime = sniffImage(decodePrefix(value, IMAGE_HEADER_BASE64_CHARS));
    return mime && fitsThumbnail(value, mime) ? `data:${mime};base64,${value}` : null;
  } catch {
    return null;
  }
}

/** The magic a cell gets, or null to show its text: links, 0–1 bars, checks and local images only. */
export function cellMagic(value: unknown, duckType: string, fraction: boolean): SqlCellMagic | null {
  if (typeof value === 'boolean') return { kind: 'check', on: value };
  if (fraction && typeof value === 'number') return { kind: 'bar', value };
  if (typeof value !== 'string') return null;
  if (duckType === 'BLOB') {
    const src = blobImage(value);
    return src ? { kind: 'image', src } : null;
  }
  if (value.startsWith('data:image/')) {
    return value.length <= THUMB_BASE64_CHARS && RASTER_DATA_URL.test(value) && validateImageSrc(value) && dataUrlFitsThumbnail(value) ? { kind: 'image', src: value } : null;
  }
  if (value.length > URL_CHARS || !HTTP_URL.test(value) || DISGUISING_CHARS.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : { kind: 'link', href: value, host: url.host };
  } catch {
    return null;
  }
}
