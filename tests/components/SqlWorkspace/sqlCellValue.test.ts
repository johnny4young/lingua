import { describe, expect, it } from 'vitest';
import {
  formatByteSize,
  hexDump,
  sniffImage,
  toDataUrl,
  viewCell,
} from '../../../src/renderer/components/SqlWorkspace/sqlCellValue';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x41]);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe('viewCell', () => {
  it('pretty-prints objects and JSON text', () => {
    expect(viewCell({ channel: 'web', n: 1n }, 'STRUCT')).toEqual({ kind: 'json', pretty: '{\n  "channel": "web",\n  "n": "1"\n}' });
    expect(viewCell('{"a":[1,2]}', 'JSON')).toMatchObject({ kind: 'json' });
    expect(viewCell('{not json', 'VARCHAR')).toEqual({ kind: 'text', text: '{not json' });
  });

  it('decodes a BLOB and recognizes an image', () => {
    const view = viewCell(base64(png), 'BLOB');
    expect(view.kind).toBe('blob');
    if (view.kind === 'blob') {
      expect(view.mime).toBe('image/png');
      expect(view.bytes).toHaveLength(png.length);
    }
    expect(viewCell(base64(new Uint8Array([1, 2, 3])), 'BLOB')).toMatchObject({ kind: 'blob', mime: null });
  });

  it('shows nulls and scalars', () => {
    expect(viewCell(null, 'VARCHAR')).toEqual({ kind: 'null' });
    expect(viewCell(42, 'INTEGER')).toEqual({ kind: 'text', text: '42' });
  });
});

describe('blob helpers', () => {
  it('sniffs common image formats only', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new Uint8Array([0x00, 0x01]))).toBeNull();
  });

  it('dumps hex with offsets and printable ASCII', () => {
    expect(hexDump(png)).toBe('000000  89 50 4e 47 0d 0a 1a 0a 00 41                    .PNG.....A');
    expect(hexDump(new Uint8Array(40), 16).split('\n')).toHaveLength(1);
  });

  it('sizes bytes and builds a data URL', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(18 * 1024)).toBe('18 KB');
    expect(toDataUrl(png, 'image/png')).toBe(`data:image/png;base64,${base64(png)}`);
  });
});
