/**
 * RL-077 — file system IPC handlers under the capability contract.
 *
 * Every handler is exercised through a freshly minted capability for a
 * real tmpdir. We don't mock node:fs/promises because the registry's
 * `realpath`-based resolution needs real filesystem operations.
 *
 * Pickers (`fs:select-directory` / `fs:select-file` / `fs:save-dialog`)
 * stub `electron.dialog` directly so we can drive them through both
 * the canceled and confirmed branches without a real Electron host.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const {
  handlers,
  showOpenDialog,
  showSaveDialog,
  showMessageBox,
  showItemInFolder,
} = vi.hoisted(
  () => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
    showItemInFolder: vi.fn(),
  })
);

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  dialog: {
    showOpenDialog,
    showSaveDialog,
    showMessageBox,
  },
  shell: {
    showItemInFolder,
  },
  BrowserWindow: { fromWebContents: vi.fn() },
  // RL-087 — fileSystem.ts now installs a `before-quit` listener via
  // `app.on(...)` for watcher cleanup. The handler is idempotent, so
  // a noop spy here is sufficient for this suite.
  app: { on: vi.fn() },
}));

import {
  _resetFilesystemApprovalsForTests,
  registerFileSystemHandlers,
} from '../../src/main/ipc/fileSystem';
import {
  clearRegistryForTests,
  mintRootCapability,
} from '../../src/main/ipc/projectCapabilities';

let tmpRoot: string;

beforeEach(async () => {
  handlers.clear();
  clearRegistryForTests();
  _resetFilesystemApprovalsForTests();
  showOpenDialog.mockReset();
  showSaveDialog.mockReset();
  showMessageBox.mockReset();
  showItemInFolder.mockReset();
  showMessageBox.mockResolvedValue({ response: 0 });
  registerFileSystemHandlers();
  tmpRoot = await mkdtemp(
    path.join(process.cwd(), '.tmp-lingua-fs-')
  );
});

afterEach(async () => {
  clearRegistryForTests();
  _resetFilesystemApprovalsForTests();
  await rm(tmpRoot, { recursive: true, force: true });
});

async function invoke(
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({ sender: { isDestroyed: () => false, send: vi.fn() } }, ...args);
}

function mintFor(rootPath: string): { rootId: string; rootPath: string } {
  return mintRootCapability(rootPath);
}

async function approveRoot(rootPath: string = tmpRoot): Promise<void> {
  showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: [rootPath],
  });
  await invoke('fs:select-directory');
  showOpenDialog.mockReset();
}

// ---------------------------------------------------------------- pickers

describe('fs:select-directory', () => {
  it('returns canceled=true when user cancels', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await invoke('fs:select-directory');
    expect(result).toEqual({ canceled: true });
  });

  it('mints a capability and returns rootId/rootPath when confirmed', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [tmpRoot],
    });
    const result = (await invoke('fs:select-directory')) as {
      canceled: false;
      rootId: string;
      rootPath: string;
    };
    expect(result.canceled).toBe(false);
    expect(typeof result.rootId).toBe('string');
    expect(result.rootId.length).toBeGreaterThan(0);
    expect(result.rootPath).toBe(path.normalize(tmpRoot));
  });

  it('rejects denylisted picks before mint', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/etc'],
    });
    await expect(invoke('fs:select-directory')).rejects.toThrow('Access denied');
  });
});

describe('fs:select-file', () => {
  it('limits the picker to code/text extensions', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await invoke('fs:select-file');
    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ['openFile'],
        filters: [
          expect.objectContaining({
            name: 'Code and text files',
            extensions: expect.arrayContaining([
              'ts',
              'py',
              'go',
              'rs',
              'lua',
              'md',
              'env',
              'csv',
              'toml',
              'ini',
            ]),
          }),
        ],
      })
    );
  });

  it('mints a single-file capability and returns content atomically', async () => {
    const filePath = path.join(tmpRoot, 'demo.ts');
    await writeFile(filePath, 'const x = 1;\n', 'utf-8');
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [filePath],
    });
    const result = (await invoke('fs:select-file')) as {
      canceled: false;
      rootId: string;
      rootPath: string;
      fileRelativePath: string;
      fileName: string;
      content: string;
    };
    expect(result.canceled).toBe(false);
    expect(result.fileRelativePath).toBe('demo.ts');
    expect(result.fileName).toBe('demo.ts');
    expect(result.content).toBe('const x = 1;\n');
    expect(result.rootPath).toBe(path.normalize(tmpRoot));
  });

  it('does not allow a picked-file capability to read siblings', async () => {
    const filePath = path.join(tmpRoot, 'demo.ts');
    await writeFile(filePath, 'const x = 1;\n', 'utf-8');
    await writeFile(path.join(tmpRoot, 'sibling.ts'), 'const y = 2;\n', 'utf-8');
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [filePath],
    });

    const result = (await invoke('fs:select-file')) as {
      canceled: false;
      rootId: string;
    };

    await expect(invoke('fs:read', result.rootId, 'sibling.ts')).rejects.toThrow(
      'unsafe-path'
    );
  });

  it.runIf(process.platform !== 'win32')(
    'rejects selected symlinks whose realpath escapes the minted parent root',
    async () => {
      const outside = await mkdtemp(
        path.join(process.cwd(), '.tmp-lingua-fs-outside-')
      );
      try {
        const target = path.join(outside, 'secret.ts');
        const link = path.join(tmpRoot, 'link.ts');
        await writeFile(target, 'secret', 'utf-8');
        await symlink(target, link);
        showOpenDialog.mockResolvedValue({
          canceled: false,
          filePaths: [link],
        });

        await expect(invoke('fs:select-file')).rejects.toThrow('escapes-root');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    }
  );
});

describe('fs:save-dialog', () => {
  it('returns canceled when user cancels', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true });
    const result = await invoke('fs:save-dialog', 'untitled.js');
    expect(result).toEqual({ canceled: true });
  });

  it('mints a single-file capability and returns the relative basename', async () => {
    const target = path.join(tmpRoot, 'saved.js');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const result = (await invoke('fs:save-dialog', 'saved.js')) as {
      canceled: false;
      rootId: string;
      rootPath: string;
      fileRelativePath: string;
    };
    expect(result.canceled).toBe(false);
    expect(result.fileRelativePath).toBe('saved.js');
    expect(result.rootPath).toBe(path.normalize(tmpRoot));
  });

  it('does not allow a save-dialog capability to write siblings', async () => {
    const target = path.join(tmpRoot, 'saved.js');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const result = (await invoke('fs:save-dialog', 'saved.js')) as {
      canceled: false;
      rootId: string;
    };

    await expect(
      invoke('fs:write', result.rootId, 'sibling.js', 'bad')
    ).rejects.toThrow('unsafe-path');
  });

  it('rejects denylisted save targets before mint', async () => {
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/etc/evil.js',
    });
    await expect(invoke('fs:save-dialog', 'evil.js')).rejects.toThrow(
      'Access denied'
    );
  });
});

// ------------------------------------------------------- root mgmt

describe('fs:reopen-root', () => {
  it('mints a fresh capability for an approved existing directory', async () => {
    await approveRoot();
    const result = (await invoke('fs:reopen-root', tmpRoot)) as {
      ok: true;
      rootId: string;
      rootPath: string;
    };
    expect(result.ok).toBe(true);
    expect(typeof result.rootId).toBe('string');
    expect(result.rootPath).toBe(path.normalize(tmpRoot));
  });

  it('returns ok=false / not-approved for an arbitrary directory', async () => {
    expect(await invoke('fs:reopen-root', tmpRoot)).toEqual({
      ok: false,
      error: 'not-approved',
    });
  });

  it('returns ok=false / not-found for an approved path that disappeared', async () => {
    await approveRoot();
    await rm(tmpRoot, { recursive: true, force: true });
    expect(await invoke('fs:reopen-root', tmpRoot)).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('returns ok=false / blocked for a denylisted path', async () => {
    expect(await invoke('fs:reopen-root', '/etc')).toEqual({
      ok: false,
      error: 'blocked',
    });
  });

  it.runIf(process.platform !== 'win32')(
    'returns ok=false / not-approved before probing arbitrary symlink roots',
    async () => {
      const link = path.join(tmpRoot, 'etc-link');
      await symlink('/etc', link);

      expect(await invoke('fs:reopen-root', link)).toEqual({
        ok: false,
        error: 'not-approved',
      });
    }
  );

  it('returns ok=false / not-a-directory when the path is a file', async () => {
    const filePath = path.join(tmpRoot, 'file.txt');
    await writeFile(filePath, '', 'utf-8');
    expect(await invoke('fs:reopen-root', filePath)).toEqual({
      ok: false,
      error: 'not-approved',
    });
  });

  it('returns ok=false / not-found for empty / non-string input', async () => {
    expect(await invoke('fs:reopen-root', '')).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await invoke('fs:reopen-root', null)).toEqual({
      ok: false,
      error: 'not-found',
    });
  });
});

describe('fs:reopen-file', () => {
  it('reopens an exact file approved through select-file', async () => {
    const filePath = path.join(tmpRoot, 'demo.ts');
    await writeFile(filePath, 'const x = 1;\n', 'utf-8');
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] });
    await invoke('fs:select-file');

    const result = (await invoke('fs:reopen-file', filePath)) as {
      ok: true;
      rootId: string;
      rootPath: string;
      fileRelativePath: string;
    };
    expect(result.ok).toBe(true);
    expect(result.rootPath).toBe(path.normalize(tmpRoot));
    expect(result.fileRelativePath).toBe('demo.ts');
    expect(await invoke('fs:read', result.rootId, result.fileRelativePath)).toBe(
      'const x = 1;\n'
    );
  });

  it('reopens a file under an approved project root', async () => {
    const filePath = path.join(tmpRoot, 'src', 'main.ts');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'export {};\n', 'utf-8');
    await approveRoot();

    const result = (await invoke('fs:reopen-file', filePath)) as {
      ok: true;
      fileRelativePath: string;
    };
    expect(result.ok).toBe(true);
    expect(result.fileRelativePath).toBe('main.ts');
  });

  it('rejects arbitrary unapproved files without revealing existence', async () => {
    const filePath = path.join(tmpRoot, 'demo.ts');
    await writeFile(filePath, 'const x = 1;\n', 'utf-8');

    expect(await invoke('fs:reopen-file', filePath)).toEqual({
      ok: false,
      error: 'not-approved',
    });
  });

  it('returns not-a-file for approved directory paths', async () => {
    await approveRoot();

    expect(await invoke('fs:reopen-file', tmpRoot)).toEqual({
      ok: false,
      error: 'not-a-file',
    });
  });
});

describe('fs:revoke-root', () => {
  it('idempotently revokes a minted capability', async () => {
    const { rootId } = mintFor(tmpRoot);
    expect(await invoke('fs:revoke-root', rootId)).toBe(true);
    expect(await invoke('fs:revoke-root', rootId)).toBe(false);
  });
});

describe('fs:reveal-in-finder', () => {
  it('resolves through the capability sandbox and reveals an existing file', async () => {
    const { rootId } = mintFor(tmpRoot);
    const filePath = path.join(tmpRoot, 'src', 'main.ts');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'export {};\n', 'utf-8');

    await expect(invoke('fs:reveal-in-finder', rootId, 'src/main.ts')).resolves.toBe(
      true
    );
    expect(showItemInFolder).toHaveBeenCalledWith(filePath);
  });

  it('returns false for stale tree entries without showing the file manager', async () => {
    const { rootId } = mintFor(tmpRoot);

    await expect(invoke('fs:reveal-in-finder', rootId, 'missing.ts')).resolves.toBe(
      false
    );
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it('rejects traversal before invoking the OS file manager', async () => {
    const { rootId } = mintFor(tmpRoot);

    await expect(
      invoke('fs:reveal-in-finder', rootId, '../outside.ts')
    ).rejects.toThrow();
    expect(showItemInFolder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- ops

describe('fs:read', () => {
  it('reads a file inside the approved root', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(path.join(tmpRoot, 'a.ts'), 'hello', 'utf-8');
    const result = await invoke('fs:read', rootId, 'a.ts');
    expect(result).toBe('hello');
  });

  it('rejects unknown rootId', async () => {
    await expect(invoke('fs:read', 'fake-rootid', 'a.ts')).rejects.toThrow(
      'unknown-root'
    );
  });

  it('rejects ".." traversal escapes', async () => {
    const { rootId } = mintFor(tmpRoot);
    await expect(
      invoke('fs:read', rootId, '../etc/passwd')
    ).rejects.toThrow();
  });

  it('rejects cross-rootId access', async () => {
    const { rootId: rootA } = mintFor(tmpRoot);
    const otherDir = await mkdtemp(
      path.join(process.cwd(), '.tmp-lingua-fs-other-')
    );
    try {
      await writeFile(path.join(otherDir, 'a.ts'), 'x', 'utf-8');
      const { rootId: rootB } = mintFor(otherDir);
      // rootA's relative path lookup against rootB cannot reach rootA.
      await expect(invoke('fs:read', rootB, '../mismatch')).rejects.toThrow();
      // rootA only sees rootA's contents — it does not have a file
      // named after the other tmpdir's basename.
      await expect(
        invoke('fs:read', rootA, path.basename(otherDir) + '/a.ts')
      ).rejects.toThrow();
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});

describe('fs:write', () => {
  it('writes a file inside the approved root', async () => {
    const { rootId } = mintFor(tmpRoot);
    const ok = await invoke('fs:write', rootId, 'b.ts', 'data');
    expect(ok).toBe(true);
  });

  it('rejects writing into a denylisted root', async () => {
    // Capability minted for /etc would itself be rejected by the resolver
    // because the realpath of /etc is denylisted on POSIX.
    const { rootId } = mintFor('/etc');
    await expect(invoke('fs:write', rootId, 'evil.txt', 'x')).rejects.toThrow();
  });
});

describe('symlinked approved roots', () => {
  it.runIf(process.platform !== 'win32')(
    'returns stable relative paths that can be fed back into later IPC calls',
    async () => {
      const realParent = await mkdtemp(
        path.join(process.cwd(), '.tmp-lingua-fs-real-')
      );
      try {
        const realProject = path.join(realParent, 'project');
        await mkdir(path.join(realProject, 'src'), { recursive: true });
        await writeFile(path.join(realProject, 'src', 'main.ts'), 'ok', 'utf-8');
        const linkedRoot = path.join(tmpRoot, 'linked-root');
        await symlink(realProject, linkedRoot);

        const { rootId } = mintFor(linkedRoot);
        const entries = (await invoke('fs:readdir', rootId, '')) as FsDirEntry[];
        expect(entries).toEqual([
          expect.objectContaining({ name: 'src', relativePath: 'src' }),
        ]);

        const indexed = (await invoke('fs:listAllFiles', rootId, '')) as Array<{
          relativePath: string;
        }>;
        expect(indexed.map((entry) => entry.relativePath)).toEqual(['src/main.ts']);
        await expect(invoke('fs:read', rootId, 'src/main.ts')).resolves.toBe('ok');
      } finally {
        await rm(realParent, { recursive: true, force: true });
      }
    }
  );
});

describe('fs:rename', () => {
  it('renames within the approved root', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(path.join(tmpRoot, 'old.ts'), 'data', 'utf-8');
    const newRel = await invoke('fs:rename', rootId, 'old.ts', 'new.ts');
    expect(newRel).toBe('new.ts');
  });

  it('rejects unsafe new names', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(path.join(tmpRoot, 'old.ts'), 'data', 'utf-8');
    await expect(
      invoke('fs:rename', rootId, 'old.ts', '../escape')
    ).rejects.toThrow('Invalid name for rename');
    await expect(
      invoke('fs:rename', rootId, 'old.ts', 'nested/file')
    ).rejects.toThrow('Invalid name for rename');
  });
});

describe('fs:listAllFiles', () => {
  it('walks the project recursively and skips hidden entries', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(path.join(tmpRoot, 'README.md'), 'r', 'utf-8');
    await mkdir(path.join(tmpRoot, 'src'));
    await writeFile(path.join(tmpRoot, 'src', 'main.ts'), 'm', 'utf-8');
    await mkdir(path.join(tmpRoot, 'src', 'utils'));
    await writeFile(
      path.join(tmpRoot, 'src', 'utils', 'helpers.ts'),
      'h',
      'utf-8'
    );
    await mkdir(path.join(tmpRoot, 'node_modules'));
    await writeFile(
      path.join(tmpRoot, 'node_modules', 'should-not-appear.ts'),
      'x',
      'utf-8'
    );

    const result = (await invoke('fs:listAllFiles', rootId, '')) as Array<{
      name: string;
      relativePath: string;
    }>;
    const sorted = result
      .map((f) => f.relativePath)
      .sort();
    expect(sorted).toEqual(['README.md', 'src/main.ts', 'src/utils/helpers.ts']);
  });

  it('keeps useful dotfiles but drops .DS_Store and .secret', async () => {
    const { rootId } = mintFor(tmpRoot);
    for (const name of ['.env', '.gitignore', '.secret', '.DS_Store']) {
      await writeFile(path.join(tmpRoot, name), 'x', 'utf-8');
    }
    const result = (await invoke('fs:listAllFiles', rootId, '')) as Array<{
      name: string;
      relativePath: string;
    }>;
    const names = result.map((f) => f.name).sort();
    expect(names).toEqual(['.env', '.gitignore']);
  });

  it('rejects an unknown rootId before walking', async () => {
    await expect(invoke('fs:listAllFiles', 'ghost', '')).rejects.toThrow(
      'unknown-root'
    );
  });
});

describe('fs:searchInFiles', () => {
  it('returns no results for an empty query without resolving the root', async () => {
    const { rootId } = mintFor(tmpRoot);
    const result = await invoke('fs:searchInFiles', rootId, '', '');
    expect(result).toEqual([]);
  });

  it('finds case-insensitive matches with previews', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(
      path.join(tmpRoot, 'main.ts'),
      "const TODO = 'fix this later';\nconsole.log(todo);\n",
      'utf-8'
    );
    await writeFile(path.join(tmpRoot, 'README.md'), 'Nothing here.\n', 'utf-8');

    const result = (await invoke(
      'fs:searchInFiles',
      rootId,
      '',
      'todo'
    )) as Array<{
      relativePath: string;
      matches: Array<{ line: number; column: number }>;
    }>;
    expect(result).toHaveLength(1);
    expect(result[0]!.relativePath).toBe('main.ts');
    expect(result[0]!.matches).toHaveLength(2);
  });

  it('skips binary files via the NUL-byte heuristic', async () => {
    const { rootId } = mintFor(tmpRoot);
    const NUL = String.fromCharCode(0);
    await writeFile(
      path.join(tmpRoot, 'asset.bin'),
      `needle${NUL}${NUL}binary payload${NUL}`,
      'utf-8'
    );
    await writeFile(path.join(tmpRoot, 'code.ts'), 'const needle = 1;\n', 'utf-8');

    const result = (await invoke(
      'fs:searchInFiles',
      rootId,
      '',
      'needle'
    )) as Array<{ relativePath: string }>;
    expect(result.map((r) => r.relativePath)).toEqual(['code.ts']);
  });

  it('caps total matches', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(
      path.join(tmpRoot, 'big.ts'),
      'needle\n'.repeat(500),
      'utf-8'
    );
    const result = (await invoke('fs:searchInFiles', rootId, '', 'needle', {
      maxTotalMatches: 3,
      maxMatchesPerFile: 10,
    })) as Array<{ matches: Array<unknown> }>;
    const total = result.reduce((sum, r) => sum + r.matches.length, 0);
    expect(total).toBeLessThanOrEqual(3);
  });

  it('rejects an unknown rootId before walking', async () => {
    await expect(
      invoke('fs:searchInFiles', 'ghost', '', 'needle')
    ).rejects.toThrow('unknown-root');
  });
});

describe('fs:mkdir', () => {
  it('creates a directory inside the approved root', async () => {
    const { rootId } = mintFor(tmpRoot);
    const ok = await invoke('fs:mkdir', rootId, 'newdir');
    expect(ok).toBe(true);
    const info = (await invoke('fs:stat', rootId, 'newdir')) as {
      isDirectory: boolean;
    };
    expect(info.isDirectory).toBe(true);
  });

  it('rejects unknown rootId', async () => {
    await expect(invoke('fs:mkdir', 'ghost', 'newdir')).rejects.toThrow(
      'unknown-root'
    );
  });
});

describe('fs:touch', () => {
  it('creates an empty file inside the approved root', async () => {
    const { rootId } = mintFor(tmpRoot);
    const ok = await invoke('fs:touch', rootId, 'fresh.ts');
    expect(ok).toBe(true);
    const content = await invoke('fs:read', rootId, 'fresh.ts');
    expect(content).toBe('');
  });

  it('rejects unknown rootId', async () => {
    await expect(invoke('fs:touch', 'ghost', 'fresh.ts')).rejects.toThrow(
      'unknown-root'
    );
  });
});

describe('fs:watch-start', () => {
  it('returns an opaque watchId for an approved root', async () => {
    const { rootId } = mintFor(tmpRoot);
    const id = await invoke('fs:watch-start', rootId, '');
    expect(typeof id).toBe('string');
    expect(id).not.toContain(tmpRoot);
    await invoke('fs:watch-stop', id as string);
  });

  it('rejects an unknown rootId', async () => {
    await expect(invoke('fs:watch-start', 'ghost', '')).rejects.toThrow(
      'unknown-root'
    );
  });
});

// ----------------------------------------- close + delete confirmation copy

describe('app:confirm-close', () => {
  it('localizes the app-close dialog in Spanish', async () => {
    await invoke('app:confirm-close', ['alpha.ts', 'beta.ts'], 'es');
    expect(showMessageBox).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        buttons: ['Guardar todo', 'Descartar', 'Cancelar'],
        title: 'Cambios sin guardar',
        message: 'Tienes cambios sin guardar en 2 archivos.',
        detail: 'alpha.ts, beta.ts',
      })
    );
  });
});

describe('app:confirm-close-tab', () => {
  it('localizes the dirty-tab dialog in English', async () => {
    await invoke('app:confirm-close-tab', 'draft.ts', 'en');
    expect(showMessageBox).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        buttons: ['Save', 'Discard', 'Cancel'],
        title: 'Unsaved Changes',
        message: '"draft.ts" has unsaved changes.',
        detail: 'Do you want to save before closing?',
      })
    );
  });
});

describe('fs:delete confirmation dialog', () => {
  it('localizes folder deletion copy in Spanish', async () => {
    const { rootId } = mintFor(tmpRoot);
    const folder = path.join(tmpRoot, 'demo-folder');
    await mkdir(folder);

    showMessageBox.mockResolvedValue({ response: 1 }); // user cancels
    await invoke('fs:delete', rootId, 'demo-folder', true, 'es');

    expect(showMessageBox).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        buttons: ['Eliminar', 'Cancelar'],
        title: 'Confirmar eliminación',
        message: '¿Eliminar "demo-folder"?',
        detail:
          'Esto eliminará permanentemente la carpeta y todo su contenido. Esta acción no se puede deshacer.',
      })
    );
  });
});
