import { validateImageSrc } from '../../../shared/richOutput';
import { sniffImage } from './sqlCellValue';

/** How a cell draws beyond its text, with Rich display on. */
export type SqlCellMagic = { kind: 'link'; href: string; host: string } | { kind: 'bar'; value: number } | { kind: 'check'; on: boolean } | { kind: 'image'; src: string };

const URL_CHARS = 2048;
/** Base64 length of about 300 KB of bytes, plenty for a 20 px thumbnail; a bigger image stays text. */
const THUMB_BASE64_CHARS = 400_000;
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
  const fractions = new Set<string>();
  for (const { name, numeric } of columns) {
    if (!numeric) continue;
    let fractional = false;
    let fits = true;
    for (const row of rows) {
      const value = row[name];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        fits = false;
        break;
      }
      if (!Number.isInteger(value)) fractional = true;
    }
    if (fits && fractional) fractions.add(name);
  }
  return fractions;
}

/** BLOBs arrive as base64, so only the first bytes are decoded to name the image and the value becomes the data URL as is. */
function blobImage(value: string): string | null {
  if (value.length > THUMB_BASE64_CHARS || !BASE64.test(value)) return null;
  try {
    const mime = sniffImage(Uint8Array.from(atob(value.slice(0, 32)), char => char.charCodeAt(0)));
    return mime ? `data:${mime};base64,${value}` : null;
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
    return value.length <= THUMB_BASE64_CHARS && RASTER_DATA_URL.test(value) && validateImageSrc(value) ? { kind: 'image', src: value } : null;
  }
  if (value.length > URL_CHARS || !HTTP_URL.test(value) || DISGUISING_CHARS.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : { kind: 'link', href: value, host: url.host };
  } catch {
    return null;
  }
}
