import { describe, expect, it, vi } from 'vitest';
import { cellMagic, fractionColumns } from '@/components/SqlWorkspace/sqlCellMagic';
import { MAX_IMAGE_SRC_LENGTH } from '@/../shared/richOutput';

const b64 = (...bytes: number[]) => btoa(String.fromCharCode(...bytes));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, n >> 8];
const be16 = (n: number) => [n >> 8, n & 255];
const ascii = (text: string) => [...text].map(char => char.charCodeAt(0));
const pngOf = (width: number, height: number) =>
  b64(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'), ...be32(width), ...be32(height));
const gifOf = (width: number, height: number) => b64(...ascii('GIF89a'), ...le16(width), ...le16(height));
const webpOf = (chunk: string, rest: number[]) => b64(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), ...rest);
const le24 = (n: number) => [n & 255, (n >> 8) & 255, n >> 16];
const vp8xOf = (width: number, height: number) => webpOf('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
const vp8Of = (width: number, height: number) => webpOf('VP8 ', [0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height)]);
const vp8lOf = (width: number, height: number) => {
  const bits = (width - 1) | ((height - 1) * 2 ** 14);
  return webpOf('VP8L', [0, 0, 0, 0, 0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, Math.floor(bits / 2 ** 24)]);
};
const jpegOf = (width: number, height: number) =>
  b64(0xff, 0xd8, 0xff, 0xe0, ...be16(4), 0, 0, 0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 0);
const PNG = pngOf(1, 1);

describe('SQL cell magics', () => {
  it.each([
    ['png', pngOf],
    ['gif', gifOf],
    ['webp VP8X', vp8xOf],
    ['webp VP8', vp8Of],
    ['webp VP8L', vp8lOf],
    ['jpeg', jpegOf],
  ] as const)('leaves a %s stated as huge as text, as a blob and as a data URL', (name, of) => {
    const mime = name.split(' ')[0];
    expect(cellMagic(of(4096, 4096), 'BLOB', false)?.kind).toBe('image');
    expect(cellMagic(of(4097, 16), 'BLOB', false)).toBeNull();
    expect(cellMagic(of(16, 4097), 'BLOB', false)).toBeNull();
    expect(cellMagic(`data:image/${mime};base64,${of(4096, 4096)}`, 'VARCHAR', false)?.kind).toBe('image');
    expect(cellMagic(`data:image/${mime};base64,${of(16, 4097)}`, 'VARCHAR', false)).toBeNull();
  });

  it('reads a lossy WebP size without its scale bits', () => {
    expect(cellMagic(vp8Of(16 | 0x4000, 16 | 0x8000), 'BLOB', false)?.kind).toBe('image');
  });

  it('reads a JPEG size past a Huffman table segment, whose marker sits among the frame markers', () => {
    const jpeg = b64(0xff, 0xd8, 0xff, 0xc4, ...be16(6), 0xff, 0xff, 0xff, 0xff, 0xff, 0xc0, ...be16(17), 8, ...be16(16), ...be16(16), 0);
    expect(cellMagic(jpeg, 'BLOB', false)?.kind).toBe('image');
  });

  it('leaves an image with no stated size as text', () => {
    expect(cellMagic(b64(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'BLOB', false)).toBeNull();
    expect(cellMagic(b64(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0), 'BLOB', false)).toBeNull();
  });

  it('draws links, checks, local images and 0–1 bars, and leaves the rest as text', () => {
    expect(cellMagic('https://lingua.dev/a?b=1', 'VARCHAR', false)).toEqual({ kind: 'link', href: 'https://lingua.dev/a?b=1', host: 'lingua.dev' });
    expect(cellMagic('https://accounts.google.com.sign-in@evil.com/', 'VARCHAR', false)).toBeNull();
    expect(cellMagic('https://lingua.dev/\u202egpj.exe', 'VARCHAR', false)).toBeNull();
    expect(cellMagic('https://lin\u200bgua.dev', 'VARCHAR', false)).toBeNull();
    expect(cellMagic('see https://lingua.dev', 'VARCHAR', false)).toBeNull();
    expect(cellMagic('javascript:alert(1)', 'VARCHAR', false)).toBeNull();
    expect(cellMagic('ftp://host/file', 'VARCHAR', false)).toBeNull();
    expect(cellMagic(true, 'BOOLEAN', false)).toEqual({ kind: 'check', on: true });
    expect(cellMagic(false, 'BOOLEAN', false)).toEqual({ kind: 'check', on: false });
    expect(cellMagic(0.42, 'DOUBLE', true)).toEqual({ kind: 'bar', value: 0.42 });
    expect(cellMagic(0.42, 'DOUBLE', false)).toBeNull();
    expect(cellMagic(PNG, 'BLOB', false)).toEqual({ kind: 'image', src: `data:image/png;base64,${PNG}` });
    expect(cellMagic(`${PNG}${'A'.repeat(16)}" onerror="x`, 'BLOB', false)).toBeNull();
    expect(cellMagic(btoa('plain bytes'), 'BLOB', false)).toBeNull();
    expect(cellMagic(`data:image/png;base64,${PNG}`, 'VARCHAR', false)).toEqual({ kind: 'image', src: `data:image/png;base64,${PNG}` });
    expect(cellMagic('data:image/svg+xml;base64,PHN2Zz4=', 'VARCHAR', false)).toBeNull();
    expect(cellMagic(`data:image/png;base64,${'A'.repeat(500_000)}`, 'VARCHAR', false)).toBeNull();
    expect(cellMagic(btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47)) + 'A'.repeat(500_000), 'BLOB', false)).toBeNull();
    expect(cellMagic('https://lingua.dev/cat.png', 'VARCHAR', false)).toEqual({ kind: 'link', href: 'https://lingua.dev/cat.png', host: 'lingua.dev' });
    expect(cellMagic(`https://x.dev/${'a'.repeat(3000)}`, 'VARCHAR', false)).toBeNull();
    expect(cellMagic(null, 'VARCHAR', false)).toBeNull();
    expect(cellMagic(`data:image/png;base64,${'A'.repeat(MAX_IMAGE_SRC_LENGTH)}`, 'VARCHAR', false)).toBeNull();
  });

  it('marks numeric columns whose loaded values are fractions from 0 to 1', () => {
    const columns = [
      { name: 'share', numeric: true },
      { name: 'flag', numeric: true },
      { name: 'big', numeric: true },
      { name: 'name', numeric: false },
    ];
    const rows = [
      { share: 0.25, flag: 1, big: 0.5, name: '0.5' },
      { share: null, flag: 0, big: 7, name: '0.1' },
      { share: 1, flag: 1, big: 0.1, name: 'x' },
    ];
    expect([...fractionColumns(columns, rows)]).toEqual(['share']);
    expect(fractionColumns(columns, [])).toEqual(new Set());
  });

  it('drops a column at its first misfit, keeps the rest in column order, and stops once none is left', () => {
    const columns = ['a', 'b', 'c', 'd'].map((name) => ({ name, numeric: true }));
    const rows = [
      { a: 0.5, b: 0.5, c: 0.5, d: 0.5 },
      { a: 2, b: 0.5, c: 'x', d: 0.5 },
      { a: 0.5, b: null, c: 0.5, d: 1 },
    ];
    expect([...fractionColumns(columns, rows)]).toEqual(['b', 'd']);

    const read = vi.fn(() => 'x');
    const lateRow = Object.defineProperty({}, 'a', { get: read });
    expect(fractionColumns([{ name: 'a', numeric: true }], [{ a: 'x' }, lateRow])).toEqual(new Set());
    expect(read).not.toHaveBeenCalled();
  });
});
