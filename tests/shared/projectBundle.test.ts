import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  BUNDLE_REJECT_REASONS,
  MAX_BUNDLE_FILES,
  PROJECT_BUNDLE_MANIFEST_NAME,
  PROJECT_BUNDLE_VERSION,
  packBundle,
  unpackBundle,
  validateBundleEntryPath,
  type ProjectBundleFile,
} from '../../src/shared/projectBundle';

const CREATED_AT = '2026-05-30T00:00:00.000Z';

function file(path: string, content = `// ${path}`): ProjectBundleFile {
  return { path, bytes: strToU8(content) };
}

describe('internal — validateBundleEntryPath', () => {
  it('accepts and normalizes plain + nested relative paths', () => {
    expect(validateBundleEntryPath('index.js')).toBe('index.js');
    expect(validateBundleEntryPath('src/utils/math.ts')).toBe('src/utils/math.ts');
  });

  it('collapses redundant separators and `.` segments', () => {
    expect(validateBundleEntryPath('src//a/./b.ts')).toBe('src/a/b.ts');
    expect(validateBundleEntryPath('a/')).toBe('a');
  });

  it('rejects traversal, absolute, drive-letter, backslash, and empty paths', () => {
    expect(validateBundleEntryPath('../etc/passwd')).toBeNull();
    expect(validateBundleEntryPath('a/../../b')).toBeNull();
    expect(validateBundleEntryPath('/etc/passwd')).toBeNull();
    expect(validateBundleEntryPath('C:\\Windows\\system32')).toBeNull();
    expect(validateBundleEntryPath('a\\..\\b')).toBeNull();
    expect(validateBundleEntryPath('a\0b')).toBeNull();
    expect(validateBundleEntryPath('')).toBeNull();
    expect(validateBundleEntryPath('.')).toBeNull();
    expect(validateBundleEntryPath('/')).toBeNull();
  });
});

describe('internal — packBundle', () => {
  it('round-trips through unpackBundle with a manifest', () => {
    const zip = packBundle([file('index.js'), file('src/lib.ts')], {
      createdAt: CREATED_AT,
      entryFile: 'index.js',
      languageHint: 'javascript',
    });
    const result = unpackBundle(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.path).sort()).toEqual([
      'index.js',
      'src/lib.ts',
    ]);
    expect(result.manifest).toMatchObject({
      version: PROJECT_BUNDLE_VERSION,
      createdAt: CREATED_AT,
      entryFile: 'index.js',
      languageHint: 'javascript',
      fileCount: 2,
    });
    // The manifest itself never lands in the extracted file set.
    expect(
      result.files.some((f) => f.path === PROJECT_BUNDLE_MANIFEST_NAME)
    ).toBe(false);
  });

  it('preserves bytes exactly (binary-safe)', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const zip = packBundle([{ path: 'asset.bin', bytes }], { createdAt: CREATED_AT });
    const result = unpackBundle(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.files[0]!.bytes)).toEqual(Array.from(bytes));
  });

  it('throws on an unsafe entry path instead of packing it', () => {
    expect(() =>
      packBundle([file('../escape.js')], { createdAt: CREATED_AT })
    ).toThrow(RangeError);
  });

  it('throws when the file count exceeds the cap', () => {
    const many = Array.from({ length: MAX_BUNDLE_FILES + 1 }, (_, i) =>
      file(`f${i}.js`)
    );
    expect(() => packBundle(many, { createdAt: CREATED_AT })).toThrow(RangeError);
  });

  it('never lets project copy shadow the manifest filename', () => {
    const zip = packBundle(
      [file(PROJECT_BUNDLE_MANIFEST_NAME, '{"evil":true}'), file('ok.js')],
      { createdAt: CREATED_AT }
    );
    const result = unpackBundle(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The injected manifest-named file was dropped; only ok.js remains,
    // and the real manifest reports a single file.
    expect(result.files.map((f) => f.path)).toEqual(['ok.js']);
    expect(result.manifest?.fileCount).toBe(1);
  });
});

describe('internal — unpackBundle guards', () => {
  it('rejects empty input', () => {
    expect(unpackBundle(new Uint8Array(0))).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('rejects non-zip bytes as malformed', () => {
    const result = unpackBundle(strToU8('not a zip at all'));
    expect(result).toEqual({ ok: false, reason: 'malformed-zip' });
  });

  it('rejects a bundle larger than the compressed cap', () => {
    const zip = packBundle([file('a.js')], { createdAt: CREATED_AT });
    const result = unpackBundle(zip, { maxBundleBytes: 4 });
    expect(result).toEqual({ ok: false, reason: 'too-large' });
  });

  it('skips a traversal entry as a per-entry reject, never extracting it', () => {
    // Hand-build a hostile zip fflate would never produce via packBundle.
    const hostile = zipSync({
      'ok.js': strToU8('console.log(1)'),
      '../escape.js': strToU8('pwned'),
    });
    const result = unpackBundle(hostile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.path)).toEqual(['ok.js']);
    expect(result.rejects).toContainEqual({
      path: '../escape.js',
      reason: 'path-traversal',
    });
  });

  it('rejects an oversize entry while keeping the rest (implementation note caps)', () => {
    const zip = zipSync({
      'big.txt': strToU8('x'.repeat(64)),
      'small.txt': strToU8('ok'),
    });
    const result = unpackBundle(zip, { maxEntryBytes: 16 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.path)).toEqual(['small.txt']);
    expect(result.rejects).toContainEqual({
      path: 'big.txt',
      reason: 'entry-too-large',
    });
  });

  it('trips the zip-bomb guard when total uncompressed size crosses the cap (implementation note)', () => {
    const zip = zipSync({
      'a.txt': strToU8('x'.repeat(40)),
      'b.txt': strToU8('y'.repeat(40)),
    });
    const result = unpackBundle(zip, { maxUncompressedBytes: 50 });
    expect(result).toEqual({ ok: false, reason: 'zip-bomb' });
  });

  it('counts manifest bytes toward the zip-bomb guard before previewing files', () => {
    const zip = zipSync({
      [PROJECT_BUNDLE_MANIFEST_NAME]: strToU8('x'.repeat(64)),
      'small.txt': strToU8('ok'),
    });
    const result = unpackBundle(zip, { maxUncompressedBytes: 50 });
    expect(result).toEqual({ ok: false, reason: 'zip-bomb' });
  });

  it('trips the too-many-files guard', () => {
    const zip = zipSync({
      'a.txt': strToU8('1'),
      'b.txt': strToU8('2'),
      'c.txt': strToU8('3'),
    });
    const result = unpackBundle(zip, { maxFiles: 2 });
    expect(result).toEqual({ ok: false, reason: 'too-many-files' });
  });

  it('rejects a manifest-only / directory-only bundle as no-files', () => {
    const zip = zipSync({ 'dir/': new Uint8Array(0) });
    expect(unpackBundle(zip)).toEqual({ ok: false, reason: 'no-files' });
  });

  it('imports loose files when the manifest is absent or wrong-version', () => {
    const noManifest = zipSync({ 'a.js': strToU8('1') });
    const r1 = unpackBundle(noManifest);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.manifest).toBeNull();

    const badVersion = zipSync({
      'a.js': strToU8('1'),
      [PROJECT_BUNDLE_MANIFEST_NAME]: strToU8(
        JSON.stringify({ version: 99, createdAt: CREATED_AT, fileCount: 1 })
      ),
    });
    const r2 = unpackBundle(badVersion);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.manifest).toBeNull();
  });
});

describe('internal — BUNDLE_REJECT_REASONS', () => {
  it('is sorted and free of duplicates (parity-test anchor)', () => {
    const arr = [...BUNDLE_REJECT_REASONS];
    expect(arr).toEqual([...arr].sort());
    expect(new Set(arr).size).toBe(arr.length);
  });
});
