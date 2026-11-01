import { describe, expect, it } from 'vitest';
import { cellMagic, fractionColumns } from '@/components/SqlWorkspace/sqlCellMagic';
import { MAX_IMAGE_SRC_LENGTH } from '@/../shared/richOutput';

const PNG = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0));

describe('SQL cell magics', () => {
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
    expect(cellMagic('data:image/png;base64,AAAA', 'VARCHAR', false)).toEqual({ kind: 'image', src: 'data:image/png;base64,AAAA' });
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
});
