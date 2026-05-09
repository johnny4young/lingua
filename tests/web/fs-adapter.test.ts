/**
 * Tests for web/fs-adapter.ts under the RL-077 capability contract.
 *
 * The File System Access API is not available in jsdom, so we either
 * mock the relevant globals (showDirectoryPicker / showOpenFilePicker)
 * or build synthetic FileSystemDirectoryHandle objects to drive the
 * adapter through the new `{ rootId, relativePath }` contract.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// ---- Synthetic FSA handle factory ---------------------------------------

interface SyntheticFile {
  name: string;
  content: string;
}

interface SyntheticDir {
  name: string;
  files?: SyntheticFile[];
  dirs?: SyntheticDir[];
}

function buildFileHandle(file: SyntheticFile): FileSystemFileHandle {
  return {
    kind: 'file',
    name: file.name,
    async getFile() {
      const blob = new Blob([file.content], { type: 'text/plain' });
      // jsdom's File constructor accepts (blobParts, name). We add a
      // `text()` polyfill in case this jsdom build lacks it.
      const f = new File([blob], file.name) as File;
      if (typeof f.text !== 'function') {
        Object.defineProperty(f, 'text', {
          value: async () => file.content,
        });
      }
      return f;
    },
    async createWritable() {
      let nextContent = '';
      return {
        async write(value: unknown) {
          nextContent =
            typeof value === 'string' ? value : String(value ?? '');
        },
        async close() {
          file.content = nextContent;
        },
      };
    },
  } as unknown as FileSystemFileHandle;
}

function buildDirHandle(dir: SyntheticDir): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory' as const,
    name: dir.name,
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      const files = (dir.files ??= []);
      let f = files.find((x) => x.name === name);
      if (!f && opts?.create) {
        f = { name, content: '' };
        files.push(f);
      }
      if (!f) throw new Error('NotFoundError');
      return buildFileHandle(f);
    },
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      const dirs = (dir.dirs ??= []);
      let d = dirs.find((x) => x.name === name);
      if (!d && opts?.create) {
        d = { name, files: [] };
        dirs.push(d);
      }
      if (!d) throw new Error('NotFoundError');
      return buildDirHandle(d);
    },
    async *entries(): AsyncGenerator<[string, FileSystemHandle]> {
      for (const f of dir.files ?? []) yield [f.name, buildFileHandle(f)];
      for (const d of dir.dirs ?? []) yield [d.name, buildDirHandle(d)];
    },
  } as unknown as FileSystemDirectoryHandle;
  return handle;
}

// ---- watch / onChanged are no-ops on the web -------------------------------

describe('webFsAdapter — watchStart / watchStop no-ops', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('watchStart returns a string id', async () => {
    const id = await webFsAdapter.watchStart('any-root', '');
    expect(typeof id).toBe('string');
  });

  it('watchStop returns true', async () => {
    const result = await webFsAdapter.watchStop('web-noop-watcher');
    expect(result).toBe(true);
  });

  it('onChanged returns an unsubscribe function', () => {
    const unsub = webFsAdapter.onChanged(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});

// ---- pickers ---------------------------------------------------------------

describe('webFsAdapter — selectDirectory cancellation', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('returns canceled=true when picker throws (user cancelled)', async () => {
    const result = await webFsAdapter.selectDirectory();
    expect(result).toEqual({ canceled: true });
  });
});

describe('webFsAdapter — selectFile cancellation', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('returns canceled=true when picker throws (user cancelled)', async () => {
    const result = await webFsAdapter.selectFile();
    expect(result).toEqual({ canceled: true });
  });
});

describe('webFsAdapter — selectFile constraints', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');
  const originalShowOpenFilePicker = window.showOpenFilePicker;

  afterEach(() => {
    if (originalShowOpenFilePicker) {
      window.showOpenFilePicker = originalShowOpenFilePicker;
      return;
    }
    delete (
      window as Window & typeof globalThis & { showOpenFilePicker?: unknown }
    ).showOpenFilePicker;
  });

  it('mints a single-file capability and returns content atomically', async () => {
    const handle = buildFileHandle({ name: 'script.ts', content: 'const x = 1;\n' });
    const showOpenFilePicker = vi.fn().mockResolvedValue([handle]);
    window.showOpenFilePicker =
      showOpenFilePicker as typeof window.showOpenFilePicker;

    const result = await webFsAdapter.selectFile();

    expect(result).toMatchObject({
      canceled: false,
      rootPath: '/',
      fileRelativePath: 'script.ts',
      fileName: 'script.ts',
      content: 'const x = 1;\n',
    });
    if (result.canceled === false) {
      expect(typeof result.rootId).toBe('string');
      expect(result.rootId.length).toBeGreaterThan(0);
    }

    expect(showOpenFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        excludeAcceptAllOption: true,
        types: [
          expect.objectContaining({
            description: 'Code and text files',
            accept: expect.objectContaining({
              'text/plain': expect.arrayContaining(['.env', '.csv', '.toml', '.ini']),
            }),
          }),
        ],
      })
    );
  });
});

describe('webFsAdapter — saveDialog single-file capability', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');
  const originalShowSaveFilePicker = window.showSaveFilePicker;

  afterEach(() => {
    if (originalShowSaveFilePicker) {
      window.showSaveFilePicker = originalShowSaveFilePicker;
      return;
    }
    delete (
      window as Window & typeof globalThis & { showSaveFilePicker?: unknown }
    ).showSaveFilePicker;
  });

  it('exposes only the chosen file inside the minted proxy root', async () => {
    const chosen = { name: 'chosen.txt', content: '' };
    window.showSaveFilePicker = vi
      .fn()
      .mockResolvedValue(buildFileHandle(chosen)) as typeof window.showSaveFilePicker;

    const picked = await webFsAdapter.saveDialog('chosen.txt');
    if (picked.canceled !== false) throw new Error('save canceled');

    expect(picked.rootPath).toBe('/');
    await expect(
      webFsAdapter.write(picked.rootId, 'other.txt', 'wrong target')
    ).resolves.toBe(false);
    await expect(
      webFsAdapter.write(picked.rootId, picked.fileRelativePath, 'ok')
    ).resolves.toBe(true);
    await expect(
      webFsAdapter.read(picked.rootId, picked.fileRelativePath)
    ).resolves.toBe('ok');
  });
});

// ---- capability registry behaviour -----------------------------------------

describe('webFsAdapter — unknown rootId rejection', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('throws "unknown-root" on readdir against an unknown token', async () => {
    await expect(webFsAdapter.readdir('not-a-real-token', '')).rejects.toThrow(
      'unknown-root'
    );
  });

  it('throws on stat against an unknown token', async () => {
    await expect(
      webFsAdapter.stat('not-a-real-token', 'whatever.ts')
    ).rejects.toThrow();
  });

  it('throws on listAllFiles against an unknown token', async () => {
    await expect(
      webFsAdapter.listAllFiles('not-a-real-token', '')
    ).rejects.toThrow('unknown-root');
  });
});

describe('webFsAdapter — selectDirectory mints + readdir round-trip', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  afterEach(() => {
    if (originalShowDirectoryPicker) {
      window.showDirectoryPicker = originalShowDirectoryPicker;
      return;
    }
    delete (
      window as Window & typeof globalThis & { showDirectoryPicker?: unknown }
    ).showDirectoryPicker;
  });

  it('mints a rootId the renderer can call readdir against', async () => {
    const dh = buildDirHandle({
      name: 'project',
      files: [
        { name: 'README.md', content: '# hi\n' },
        { name: 'script.ts', content: 'const x = 1;\n' },
      ],
      dirs: [{ name: 'src', files: [{ name: 'main.ts', content: 'main\n' }] }],
    });
    window.showDirectoryPicker = vi
      .fn()
      .mockResolvedValue(dh) as typeof window.showDirectoryPicker;

    const picked = await webFsAdapter.selectDirectory();
    expect(picked.canceled).toBe(false);
    if (picked.canceled !== false) return;

    const entries = await webFsAdapter.readdir(picked.rootId, '');
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['README.md', 'script.ts', 'src']);
    const dirEntry = entries.find((e) => e.name === 'src');
    expect(dirEntry?.isDirectory).toBe(true);
  });
});

describe('webFsAdapter — listAllFiles walks recursively', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  afterEach(() => {
    if (originalShowDirectoryPicker) {
      window.showDirectoryPicker = originalShowDirectoryPicker;
      return;
    }
    delete (
      window as Window & typeof globalThis & { showDirectoryPicker?: unknown }
    ).showDirectoryPicker;
  });

  it('returns relative paths and skips hidden directories', async () => {
    const dh = buildDirHandle({
      name: 'project',
      files: [{ name: 'top.md', content: 'top\n' }],
      dirs: [
        {
          name: 'src',
          files: [{ name: 'main.ts', content: 'main\n' }],
          dirs: [{ name: 'utils', files: [{ name: 'helpers.ts', content: 'h\n' }] }],
        },
        {
          name: 'node_modules', // must be hidden
          files: [{ name: 'leak.js', content: 'leak\n' }],
        },
      ],
    });
    window.showDirectoryPicker = vi
      .fn()
      .mockResolvedValue(dh) as typeof window.showDirectoryPicker;

    const picked = await webFsAdapter.selectDirectory();
    if (picked.canceled !== false) throw new Error('picker canceled');

    const files = await webFsAdapter.listAllFiles(picked.rootId, '');
    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['src/main.ts', 'src/utils/helpers.ts', 'top.md']);
  });
});

describe('webFsAdapter — searchInFiles', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  afterEach(() => {
    if (originalShowDirectoryPicker) {
      window.showDirectoryPicker = originalShowDirectoryPicker;
      return;
    }
    delete (
      window as Window & typeof globalThis & { showDirectoryPicker?: unknown }
    ).showDirectoryPicker;
  });

  it('short-circuits empty queries without resolving the root', async () => {
    const result = await webFsAdapter.searchInFiles('not-a-real-token', '', '');
    expect(result).toEqual([]);
  });

  it('finds case-insensitive matches and skips binary files', async () => {
    const dh = buildDirHandle({
      name: 'project',
      files: [
        { name: 'code.ts', content: "const TODO = 'fix';\nconsole.log(todo);\n" },
        {
          name: 'asset.bin',
          content: `${'todo'}${String.fromCharCode(0)}binary`,
        },
      ],
    });
    window.showDirectoryPicker = vi
      .fn()
      .mockResolvedValue(dh) as typeof window.showDirectoryPicker;

    const picked = await webFsAdapter.selectDirectory();
    if (picked.canceled !== false) throw new Error('picker canceled');

    const result = await webFsAdapter.searchInFiles(picked.rootId, '', 'todo');
    expect(result.map((r) => r.relativePath)).toEqual(['code.ts']);
    expect(result[0]!.matches).toHaveLength(2);
  });
});

describe('webFsAdapter — traversal rejection', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  afterEach(() => {
    if (originalShowDirectoryPicker) {
      window.showDirectoryPicker = originalShowDirectoryPicker;
      return;
    }
    delete (
      window as Window & typeof globalThis & { showDirectoryPicker?: unknown }
    ).showDirectoryPicker;
  });

  it('rejects ".." escapes against a known rootId', async () => {
    const dh = buildDirHandle({ name: 'project', files: [] });
    window.showDirectoryPicker = vi
      .fn()
      .mockResolvedValue(dh) as typeof window.showDirectoryPicker;

    const picked = await webFsAdapter.selectDirectory();
    if (picked.canceled !== false) throw new Error('picker canceled');

    await expect(
      webFsAdapter.readdir(picked.rootId, '../escape')
    ).rejects.toThrow('unsafe-path');
  });

  it('rejects NUL byte in relativePath', async () => {
    const dh = buildDirHandle({ name: 'project', files: [] });
    window.showDirectoryPicker = vi
      .fn()
      .mockResolvedValue(dh) as typeof window.showDirectoryPicker;

    const picked = await webFsAdapter.selectDirectory();
    if (picked.canceled !== false) throw new Error('picker canceled');

    await expect(
      webFsAdapter.readdir(picked.rootId, `evil${String.fromCharCode(0)}name`)
    ).rejects.toThrow('unsafe-path');
  });

  it('rejects Windows drive-relative paths such as C:foo', async () => {
    const dh = buildDirHandle({ name: 'project', files: [] });
    window.showDirectoryPicker = vi
      .fn()
      .mockResolvedValue(dh) as typeof window.showDirectoryPicker;

    const picked = await webFsAdapter.selectDirectory();
    if (picked.canceled !== false) throw new Error('picker canceled');

    await expect(webFsAdapter.readdir(picked.rootId, 'C:foo')).rejects.toThrow(
      'unsafe-path'
    );
  });
});

describe('webFsAdapter — rename safety', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  afterEach(() => {
    if (originalShowDirectoryPicker) {
      window.showDirectoryPicker = originalShowDirectoryPicker;
      return;
    }
    delete (
      window as Window & typeof globalThis & { showDirectoryPicker?: unknown }
    ).showDirectoryPicker;
  });

  it('rejects unsafe new names without deleting the original file', async () => {
    const dh = buildDirHandle({
      name: 'project',
      files: [{ name: 'old.ts', content: 'keep me' }],
    });
    window.showDirectoryPicker = vi
      .fn()
      .mockResolvedValue(dh) as typeof window.showDirectoryPicker;

    const picked = await webFsAdapter.selectDirectory();
    if (picked.canceled !== false) throw new Error('picker canceled');

    await expect(
      webFsAdapter.rename(picked.rootId, 'old.ts', '../escape.ts')
    ).rejects.toThrow('unsafe-path');
    await expect(webFsAdapter.read(picked.rootId, 'old.ts')).resolves.toBe(
      'keep me'
    );
  });
});

describe('webFsAdapter — reopenRoot is unsupported on the web', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('returns ok=false / not-found for any path', async () => {
    const result = await webFsAdapter.reopenRoot('/anything');
    expect(result).toEqual({ ok: false, error: 'not-found' });
  });

  it('returns ok=false / not-found for file reopen attempts too', async () => {
    const result = await webFsAdapter.reopenFile('/anything.txt');
    expect(result).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('webFsAdapter — revokeRoot', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  afterEach(() => {
    if (originalShowDirectoryPicker) {
      window.showDirectoryPicker = originalShowDirectoryPicker;
      return;
    }
    delete (
      window as Window & typeof globalThis & { showDirectoryPicker?: unknown }
    ).showDirectoryPicker;
  });

  it('drops the capability so subsequent reads fail', async () => {
    const dh = buildDirHandle({ name: 'project', files: [] });
    window.showDirectoryPicker = vi
      .fn()
      .mockResolvedValue(dh) as typeof window.showDirectoryPicker;

    const picked = await webFsAdapter.selectDirectory();
    if (picked.canceled !== false) throw new Error('picker canceled');

    expect(await webFsAdapter.revokeRoot(picked.rootId)).toBe(true);
    expect(await webFsAdapter.revokeRoot(picked.rootId)).toBe(false); // idempotent
    await expect(webFsAdapter.readdir(picked.rootId, '')).rejects.toThrow(
      'unknown-root'
    );
  });
});
