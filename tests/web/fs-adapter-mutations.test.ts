/**
 * Web FSA adapter mutations: rename, touch and search against a byte-backed
 * synthetic directory, so binary content and deletions are observable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { asRelativePath, type RootId } from '../../src/shared/fs/brandedIds';
import { webFsAdapter } from '../../src/web/fs-adapter';

interface MemFile {
  name: string;
  bytes: Uint8Array;
}

interface MemDir {
  name: string;
  files: MemFile[];
  dirs: MemDir[];
}

interface HandleOptions {
  withMove?: boolean;
}

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function fileHandle(file: MemFile, parent: MemDir, options: HandleOptions): FileSystemFileHandle {
  const handle: Record<string, unknown> = {
    kind: 'file',
    name: file.name,
    async getFile() {
      return new File([file.bytes.slice()], file.name);
    },
    async createWritable() {
      let next = new Uint8Array();
      return {
        async write(value: unknown) {
          if (typeof value === 'string') next = encode(value);
          else if (value instanceof ArrayBuffer) next = new Uint8Array(value);
          else if (ArrayBuffer.isView(value)) {
            next = Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
          }
          else throw new Error('unsupported write chunk');
        },
        async close() {
          file.bytes = next;
        },
        async abort() {},
      };
    },
  };
  if (options.withMove) {
    handle.move = async (newName: string) => {
      if (parent.files.some((entry) => entry !== file && entry.name === newName)) {
        throw new Error('move target exists');
      }
      file.name = newName;
    };
  }
  return handle as unknown as FileSystemFileHandle;
}

function dirHandle(dir: MemDir, parent: MemDir | null, options: HandleOptions): FileSystemDirectoryHandle {
  const handle: Record<string, unknown> = {
    kind: 'directory',
    name: dir.name,
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      let file = dir.files.find((entry) => entry.name === name);
      if (!file && opts?.create) {
        file = { name, bytes: new Uint8Array() };
        dir.files.push(file);
      }
      if (!file) throw new Error('NotFoundError');
      return fileHandle(file, dir, options);
    },
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      let child = dir.dirs.find((entry) => entry.name === name);
      if (!child && opts?.create) {
        child = { name, files: [], dirs: [] };
        dir.dirs.push(child);
      }
      if (!child) throw new Error('NotFoundError');
      return dirHandle(child, dir, options);
    },
    async removeEntry(name: string) {
      const fileIndex = dir.files.findIndex((entry) => entry.name === name);
      if (fileIndex >= 0) {
        dir.files.splice(fileIndex, 1);
        return;
      }
      const dirIndex = dir.dirs.findIndex((entry) => entry.name === name);
      if (dirIndex >= 0) {
        dir.dirs.splice(dirIndex, 1);
        return;
      }
      throw new Error('NotFoundError');
    },
    async *entries() {
      for (const file of dir.files) yield [file.name, fileHandle(file, dir, options)];
      for (const child of dir.dirs) yield [child.name, dirHandle(child, dir, options)];
    },
  };
  if (options.withMove && parent) {
    handle.move = async (newName: string) => {
      dir.name = newName;
    };
  }
  return handle as unknown as FileSystemDirectoryHandle;
}

const pickerWindow = window as Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

async function mount(root: MemDir, options: HandleOptions = {}): Promise<RootId> {
  pickerWindow.showDirectoryPicker = vi.fn().mockResolvedValue(dirHandle(root, null, options));
  const picked = await webFsAdapter.selectDirectory();
  if (picked.canceled !== false) throw new Error('picker canceled');
  return picked.rootId;
}

afterEach(() => {
  delete pickerWindow.showDirectoryPicker;
});

describe('webFsAdapter.rename', () => {
  it('treats renaming to the same name as a no-op', async () => {
    const root: MemDir = { name: 'p', files: [{ name: 'a.ts', bytes: encode('keep me') }], dirs: [] };
    const rootId = await mount(root);
    await expect(webFsAdapter.rename(rootId, asRelativePath('a.ts'), 'a.ts')).resolves.toBe('a.ts');
    expect(root.files.map((file) => [file.name, decode(file.bytes)])).toEqual([['a.ts', 'keep me']]);
  });

  it('refuses to overwrite an existing sibling, including a case variant', async () => {
    const root: MemDir = {
      name: 'p',
      files: [
        { name: 'a.ts', bytes: encode('A') },
        { name: 'b.ts', bytes: encode('B') },
      ],
      dirs: [],
    };
    const rootId = await mount(root);
    await expect(webFsAdapter.rename(rootId, asRelativePath('a.ts'), 'b.ts')).rejects.toThrow(
      'already exists'
    );
    await expect(webFsAdapter.rename(rootId, asRelativePath('a.ts'), 'B.ts')).rejects.toThrow(
      'already exists'
    );
    expect(root.files.map((file) => [file.name, decode(file.bytes)])).toEqual([
      ['a.ts', 'A'],
      ['b.ts', 'B'],
    ]);
  });

  it('copies binary bytes exactly when move() is unavailable', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80]);
    const root: MemDir = { name: 'p', files: [{ name: 'img.png', bytes: png }], dirs: [] };
    const rootId = await mount(root);
    await expect(webFsAdapter.rename(rootId, asRelativePath('img.png'), 'logo.png')).resolves.toBe(
      'logo.png'
    );
    expect(root.files.map((file) => file.name)).toEqual(['logo.png']);
    expect(Array.from(root.files[0]!.bytes)).toEqual(Array.from(png));
  });

  it('uses move() for files and folders when the browser provides it', async () => {
    const root: MemDir = {
      name: 'p',
      files: [{ name: 'a.ts', bytes: encode('A') }],
      dirs: [{ name: 'src', files: [{ name: 'x.ts', bytes: encode('X') }], dirs: [] }],
    };
    const rootId = await mount(root, { withMove: true });
    await expect(webFsAdapter.rename(rootId, asRelativePath('src'), 'lib')).resolves.toBe('lib');
    await expect(webFsAdapter.rename(rootId, asRelativePath('a.ts'), 'A.ts')).resolves.toBe('A.ts');
    expect(root.dirs.map((dir) => dir.name)).toEqual(['lib']);
    expect(root.dirs[0]!.files.map((file) => decode(file.bytes))).toEqual(['X']);
    expect(root.files.map((file) => file.name)).toEqual(['A.ts']);
  });

  it('fails clearly for folders and case-only renames without move()', async () => {
    const root: MemDir = {
      name: 'p',
      files: [{ name: 'a.ts', bytes: encode('A') }],
      dirs: [{ name: 'src', files: [], dirs: [] }],
    };
    const rootId = await mount(root);
    await expect(webFsAdapter.rename(rootId, asRelativePath('src'), 'lib')).rejects.toThrow(
      'Renaming folders is not supported'
    );
    await expect(webFsAdapter.rename(rootId, asRelativePath('a.ts'), 'A.ts')).rejects.toThrow(
      'letter case'
    );
    expect(root.dirs.map((dir) => dir.name)).toEqual(['src']);
    expect(root.files.map((file) => file.name)).toEqual(['a.ts']);
  });
});

describe('webFsAdapter.touch', () => {
  it('reports an existing file as not created and keeps its bytes', async () => {
    const root: MemDir = { name: 'p', files: [{ name: 'a.ts', bytes: encode('A') }], dirs: [] };
    const rootId = await mount(root);
    await expect(webFsAdapter.touch(rootId, asRelativePath('a.ts'))).resolves.toBe(false);
    await expect(webFsAdapter.touch(rootId, asRelativePath('b.ts'))).resolves.toBe(true);
    expect(root.files.map((file) => [file.name, decode(file.bytes)])).toEqual([
      ['a.ts', 'A'],
      ['b.ts', ''],
    ]);
  });
});

describe('webFsAdapter.searchInFiles columns', () => {
  it('reports columns against the original line after length-changing case folds', async () => {
    const root: MemDir = { name: 'p', files: [{ name: 'a.txt', bytes: encode('İstanbul foo\n') }], dirs: [] };
    const rootId = await mount(root);
    const [result] = await webFsAdapter.searchInFiles(rootId, asRelativePath(''), 'FOO');
    const match = result!.matches[0]!;
    expect(match.column).toBe(10);
    expect(match.preview.slice(match.matchStart, match.matchEnd)).toBe('foo');
  });
});
