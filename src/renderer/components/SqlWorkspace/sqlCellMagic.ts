import { validateImageSrc } from '../../../shared/richOutput';
import { sniffImage, toDataUrl } from './sqlCellValue';

/** How a cell draws beyond its text, with Rich display on. */
export type SqlCellMagic = { kind: 'link'; href: string } | { kind: 'bar'; value: number } | { kind: 'check'; on: boolean } | { kind: 'image'; src: string };

const URL_CHARS = 2048;
/** Base64 length of about 1 MB of bytes; a bigger BLOB stays text. */
const THUMB_BASE64_CHARS = 1_400_000;
const HTTP_URL = /^https?:\/\/[^\s<>"]+$/i;

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

function blobImage(value: string): string | null {
  if (value.length > THUMB_BASE64_CHARS) return null;
  try {
    const binary = atob(value.slice(0, 32));
    const head = Uint8Array.from(binary, char => char.charCodeAt(0));
    const mime = sniffImage(head);
    if (!mime) return null;
    const full = atob(value);
    return toDataUrl(Uint8Array.from(full, char => char.charCodeAt(0)), mime);
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
    const src = validateImageSrc(value);
    return src ? { kind: 'image', src } : null;
  }
  if (value.length <= URL_CHARS && HTTP_URL.test(value)) return { kind: 'link', href: value };
  return null;
}
