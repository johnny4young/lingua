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
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { packBundle, unpackBundle } from '../../src/shared/projectBundle';

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
  pathIntersectsApprovedScope,
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
  return handler(
    {
      sender: {
        id: 1,
        isDestroyed: () => false,
        send: vi.fn(),
        // watch-start ties watcher lifecycle to the sender via a one-time
        // 'destroyed' listener (B14); this suite never fires it, so a
        // no-op capture is enough.
        once: vi.fn(),
      },
    },
    ...args
  );
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

  it('returns a blocked family for denylisted picks before mint', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/etc'],
    });
    await expect(invoke('fs:select-directory')).resolves.toEqual({
      canceled: true,
      blockedFamily: 'system',
    });
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

  it('returns a blocked family for denylisted files before mint', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/etc/passwd'],
    });
    await expect(invoke('fs:select-file')).resolves.toEqual({
      canceled: true,
      blockedFamily: 'system',
    });
  });
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

  it('returns a blocked family for denylisted save targets before mint', async () => {
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/etc/evil.js',
    });
    await expect(invoke('fs:save-dialog', 'evil.js')).resolves.toEqual({
      canceled: true,
      blockedFamily: 'system',
    });
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

  it('preserves leading whitespace in the search query', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(
      path.join(tmpRoot, 'main.ts'),
      'todo\n  todo\n',
      'utf-8'
    );

    const result = (await invoke(
      'fs:searchInFiles',
      rootId,
      '',
      '  todo'
    )) as Array<{ matches: Array<{ column: number }> }>;
    expect(result).toHaveLength(1);
    expect(result[0]!.matches).toHaveLength(1);
    expect(result[0]!.matches[0]!.column).toBe(1);
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

// ----------------------------------------------- RL-024 Slice 2: replace
//
// `fs:replaceInFiles` (preview) and `fs:applyReplaceInFile` (atomic
// write). Same capability contract as `fs:searchInFiles`; the apply
// path also covers binary skip, too-large skip, regex backrefs, and
// atomic-via-tmpfile-rename.

import { readFile as readFileNode } from 'node:fs/promises';

describe('fs:replaceInFiles (preview)', () => {
  it('returns no results when query is empty', async () => {
    const { rootId } = mintFor(tmpRoot);
    const result = await invoke(
      'fs:replaceInFiles',
      rootId,
      '',
      '',
      'new',
      {}
    );
    expect(result).toEqual([]);
  });

  it('previews literal substitution with replacedPreview per match', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(
      path.join(tmpRoot, 'a.ts'),
      'const oldName = 1;\nlog(oldName);\n',
      'utf-8'
    );
    const result = (await invoke(
      'fs:replaceInFiles',
      rootId,
      '',
      'oldName',
      'newName',
      {}
    )) as Array<{
      relativePath: string;
      matches: Array<{
        preview: string;
        replacedPreview: string;
        replacement: string;
      }>;
    }>;
    expect(result).toHaveLength(1);
    expect(result[0]!.matches).toHaveLength(2);
    expect(result[0]!.matches[0]!.replacement).toBe('newName');
    expect(result[0]!.matches[0]!.replacedPreview).toContain('newName');
    expect(result[0]!.matches[0]!.preview).toContain('oldName');
  });

  it('honors the regex flag with backreferences', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(
      path.join(tmpRoot, 'a.ts'),
      'foo(123) bar(456)\n',
      'utf-8'
    );
    const result = (await invoke(
      'fs:replaceInFiles',
      rootId,
      '',
      '(foo|bar)\\((\\d+)\\)',
      '$1=$2',
      { regex: true }
    )) as Array<{ matches: Array<{ replacement: string }> }>;
    expect(result).toHaveLength(1);
    expect(result[0]!.matches.map((m) => m.replacement)).toEqual([
      'foo=123',
      'bar=456',
    ]);
  });

  it('treats dollar sequences literally when regex mode is off', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(path.join(tmpRoot, 'a.ts'), 'oldName\n', 'utf-8');
    const result = (await invoke(
      'fs:replaceInFiles',
      rootId,
      '',
      'oldName',
      '$&-$1',
      {}
    )) as Array<{ matches: Array<{ replacement: string; replacedPreview: string }> }>;
    expect(result[0]!.matches[0]!.replacement).toBe('$&-$1');
    expect(result[0]!.matches[0]!.replacedPreview).toContain('$&-$1');
  });

  it('sanitizes malformed option payloads instead of disabling caps', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(
      path.join(tmpRoot, 'a.ts'),
      'oldName\n'.repeat(20),
      'utf-8'
    );
    const result = (await invoke(
      'fs:replaceInFiles',
      rootId,
      '',
      'oldName',
      'newName',
      { maxTotalMatches: Number.NaN, maxMatchesPerFile: Number.POSITIVE_INFINITY }
    )) as Array<{ matches: Array<unknown> }>;
    const total = result.reduce((sum, row) => sum + row.matches.length, 0);
    expect(total).toBeLessThanOrEqual(20);
    expect(total).toBeGreaterThan(0);
  });

  it('skips binary files via the NUL probe', async () => {
    const { rootId } = mintFor(tmpRoot);
    const NUL = String.fromCharCode(0);
    await writeFile(
      path.join(tmpRoot, 'asset.bin'),
      `oldName${NUL}${NUL}\n`,
      'utf-8'
    );
    await writeFile(
      path.join(tmpRoot, 'code.ts'),
      'const oldName = 1;\n',
      'utf-8'
    );
    const result = (await invoke(
      'fs:replaceInFiles',
      rootId,
      '',
      'oldName',
      'newName',
      {}
    )) as Array<{ relativePath: string }>;
    expect(result.map((r) => r.relativePath)).toEqual(['code.ts']);
  });

  it('returns no results for an invalid regex', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(path.join(tmpRoot, 'a.ts'), 'oldName\n', 'utf-8');
    const result = (await invoke(
      'fs:replaceInFiles',
      rootId,
      '',
      '(unbalanced',
      'x',
      { regex: true }
    )) as unknown[];
    expect(result).toEqual([]);
  });

  it('rejects an unknown rootId before walking', async () => {
    await expect(
      invoke('fs:replaceInFiles', 'ghost', '', 'needle', 'x', {})
    ).rejects.toThrow('unknown-root');
  });
});

describe('fs:applyReplaceInFile (atomic write)', () => {
  it('rewrites a single file and returns the replaced count', async () => {
    const { rootId } = mintFor(tmpRoot);
    const filePath = path.join(tmpRoot, 'a.ts');
    await writeFile(filePath, 'const oldName = 1;\nlog(oldName);\n', 'utf-8');

    const result = (await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'a.ts',
      'oldName',
      'newName',
      {}
    )) as { ok: boolean; replaced: number; reason?: string };
    expect(result).toEqual({ ok: true, replaced: 2 });
    const after = await readFileNode(filePath, 'utf-8');
    expect(after).toBe('const newName = 1;\nlog(newName);\n');
  });

  it('returns no-matches when the query is empty or absent', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(
      path.join(tmpRoot, 'a.ts'),
      'const foo = 1;\n',
      'utf-8'
    );

    const empty = (await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'a.ts',
      '',
      'x',
      {}
    )) as { ok: boolean; reason: string };
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe('no-matches');

    const absent = (await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'a.ts',
      'oldName',
      'newName',
      {}
    )) as { ok: boolean; reason: string };
    expect(absent.ok).toBe(false);
    expect(absent.reason).toBe('no-matches');
  });

  it('returns invalid-regex on a malformed regex', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(path.join(tmpRoot, 'a.ts'), 'oldName\n', 'utf-8');
    const result = (await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'a.ts',
      '(unbalanced',
      'x',
      { regex: true }
    )) as { ok: boolean; reason: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-regex');
  });

  it('returns binary when the file has NUL bytes in the first 1 KB', async () => {
    const { rootId } = mintFor(tmpRoot);
    const NUL = String.fromCharCode(0);
    await writeFile(
      path.join(tmpRoot, 'asset.bin'),
      `${NUL}oldName${NUL}\n`,
      'utf-8'
    );
    const result = (await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'asset.bin',
      'oldName',
      'newName',
      {}
    )) as { ok: boolean; reason: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('binary');
  });

  it('returns too-large when the file exceeds the size cap', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(
      path.join(tmpRoot, 'a.ts'),
      'oldName\n'.repeat(100),
      'utf-8'
    );
    const result = (await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'a.ts',
      'oldName',
      'newName',
      { maxFileSize: 10 }
    )) as { ok: boolean; reason: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('too-large');
  });

  it('returns read-error when the file does not exist', async () => {
    const { rootId } = mintFor(tmpRoot);
    const result = (await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'missing.ts',
      'oldName',
      'newName',
      {}
    )) as { ok: boolean; reason: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('read-error');
  });

  it('applies regex backreferences atomically', async () => {
    const { rootId } = mintFor(tmpRoot);
    const filePath = path.join(tmpRoot, 'a.ts');
    await writeFile(filePath, 'foo(123) bar(456)\n', 'utf-8');
    const result = (await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'a.ts',
      '(foo|bar)\\((\\d+)\\)',
      '$1=$2',
      { regex: true }
    )) as { ok: boolean; replaced: number };
    expect(result).toEqual({ ok: true, replaced: 2 });
    expect(await readFileNode(filePath, 'utf-8')).toBe('foo=123 bar=456\n');
  });

  it('applies literal dollar replacements without JS replacement expansion', async () => {
    const { rootId } = mintFor(tmpRoot);
    const filePath = path.join(tmpRoot, 'a.ts');
    await writeFile(filePath, 'oldName oldName\n', 'utf-8');
    const result = (await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'a.ts',
      'oldName',
      '$&-$1',
      {}
    )) as { ok: boolean; replaced: number };
    expect(result).toEqual({ ok: true, replaced: 2 });
    expect(await readFileNode(filePath, 'utf-8')).toBe('$&-$1 $&-$1\n');
  });

  it('rejects an unknown rootId before reading', async () => {
    await expect(
      invoke('fs:applyReplaceInFile', 'ghost', 'a.ts', 'oldName', 'newName', {})
    ).rejects.toThrow('unknown-root');
  });

  it('cleans up the tmpfile after a successful rename', async () => {
    const { rootId } = mintFor(tmpRoot);
    await writeFile(path.join(tmpRoot, 'a.ts'), 'oldName\n', 'utf-8');
    await invoke(
      'fs:applyReplaceInFile',
      rootId,
      'a.ts',
      'oldName',
      'newName',
      {}
    );
    // Should be exactly the original file, no .tmp-* siblings left behind.
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(tmpRoot);
    expect(entries).toEqual(['a.ts']);
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
  it('localizes folder deletion copy in Spanish and aborts on cancel', async () => {
    const { rootId } = mintFor(tmpRoot);
    const folder = path.join(tmpRoot, 'demo-folder');
    await mkdir(folder);

    showMessageBox.mockResolvedValue({ response: 1 }); // user cancels
    const result = await invoke('fs:delete', rootId, 'demo-folder', true, 'es');

    expect(result).toBe(false);
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Eliminar', 'Cancelar'],
        title: 'Confirmar eliminación',
        message: '¿Eliminar "demo-folder"?',
        detail:
          'Esto eliminará permanentemente la carpeta y todo su contenido. Esta acción no se puede deshacer.',
      })
    );
    await expect(stat(folder)).resolves.toBeTruthy();
  });

  it('deletes a file after the native confirmation is accepted', async () => {
    const { rootId } = mintFor(tmpRoot);
    const file = path.join(tmpRoot, 'doomed.txt');
    await writeFile(file, 'bye');

    const result = await invoke('fs:delete', rootId, 'doomed.txt', false);

    expect(result).toBe(true);
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Delete', 'Cancel'],
        title: 'Confirm Delete',
        message: 'Delete "doomed.txt"?',
        detail: 'This action cannot be undone.',
      })
    );
    await expect(stat(file)).rejects.toThrow();
  });
});

// ----------------------------------------------- RL-024 Slice 3 bundles

describe('fs:exportBundle', () => {
  it('packs visible files (excluding node_modules / dist) into a saved zip', async () => {
    await writeFile(path.join(tmpRoot, 'index.js'), 'console.log(1)');
    await mkdir(path.join(tmpRoot, 'src'));
    await writeFile(path.join(tmpRoot, 'src', 'lib.ts'), 'export const x = 1;');
    // Excluded dir — must NOT appear in the bundle (fold G via shouldHide).
    await mkdir(path.join(tmpRoot, 'node_modules', 'dep'), { recursive: true });
    await writeFile(
      path.join(tmpRoot, 'node_modules', 'dep', 'index.js'),
      'module.exports = {}'
    );
    const { rootId } = mintFor(tmpRoot);
    const outPath = path.join(tmpRoot, '..', `bundle-${path.basename(tmpRoot)}.zip`);
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: outPath });

    const result = (await invoke('fs:exportBundle', rootId, {
      entryFile: 'index.js',
      languageHint: 'javascript',
    })) as { ok: true; fileCount: number; byteLength: number };

    expect(result.ok).toBe(true);
    expect(result.fileCount).toBe(2);

    const written = await readFile(outPath);
    const unpacked = unpackBundle(new Uint8Array(written));
    expect(unpacked.ok).toBe(true);
    if (unpacked.ok) {
      expect(unpacked.files.map((f) => f.path).sort()).toEqual([
        'index.js',
        'src/lib.ts',
      ]);
      expect(unpacked.manifest?.entryFile).toBe('index.js');
    }
    await rm(outPath, { force: true });
  });

  it('returns canceled when the save dialog is dismissed', async () => {
    await writeFile(path.join(tmpRoot, 'a.js'), '1');
    const { rootId } = mintFor(tmpRoot);
    showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await invoke('fs:exportBundle', rootId)).toEqual({ canceled: true });
  });

  it('reports empty for a project with no visible files', async () => {
    const { rootId } = mintFor(tmpRoot);
    expect(await invoke('fs:exportBundle', rootId)).toEqual({
      ok: false,
      reason: 'empty',
    });
  });
});

describe('fs:importBundle', () => {
  it('extracts a bundle into a chosen empty dir and approves the root', async () => {
    const zip = packBundle(
      [
        { path: 'index.js', bytes: strToU8('console.log(1)') },
        { path: 'src/lib.ts', bytes: strToU8('export const x = 1;') },
      ],
      { createdAt: '2026-05-30T00:00:00.000Z', entryFile: 'index.js' }
    );
    const target = path.join(tmpRoot, 'imported');
    await mkdir(target);
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [target] });

    const result = (await invoke('fs:importBundle', zip)) as {
      ok: true;
      rootPath: string;
      fileCount: number;
      entryFile?: string;
    };
    expect(result.ok).toBe(true);
    expect(result.fileCount).toBe(2);
    expect(result.entryFile).toBe('index.js');
    expect(await readFile(path.join(target, 'index.js'), 'utf-8')).toBe(
      'console.log(1)'
    );
    expect(await readFile(path.join(target, 'src', 'lib.ts'), 'utf-8')).toBe(
      'export const x = 1;'
    );

    // rememberApprovedRoot ran, so reopen-root now succeeds for the target.
    const reopened = (await invoke('fs:reopen-root', target)) as {
      ok: boolean;
    };
    expect(reopened.ok).toBe(true);
  });

  it('never writes a traversal entry outside the chosen dir (zip-slip)', async () => {
    // unpackBundle drops `../escape` as a reject; nothing escapes the dir.
    const hostile = zipSync({
      'ok.js': strToU8('1'),
      '../escape.js': strToU8('pwned'),
    });
    const target = path.join(tmpRoot, 'slip-target');
    await mkdir(target);
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [target] });

    const result = (await invoke('fs:importBundle', hostile)) as {
      ok: true;
      fileCount: number;
    };
    expect(result.ok).toBe(true);
    expect(result.fileCount).toBe(1);
    // The escape target must not exist as a sibling of the chosen dir.
    await expect(
      readFile(path.join(tmpRoot, 'escape.js'), 'utf-8')
    ).rejects.toThrow();
  });

  it('refuses to import into a non-empty directory', async () => {
    const zip = packBundle([{ path: 'a.js', bytes: strToU8('1') }], {
      createdAt: '2026-05-30T00:00:00.000Z',
    });
    const target = path.join(tmpRoot, 'occupied');
    await mkdir(target);
    await writeFile(path.join(target, 'existing.txt'), 'keep me');
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [target] });

    expect(await invoke('fs:importBundle', zip)).toEqual({
      ok: false,
      reason: 'non-empty-dir',
    });
  });

  it('rejects a malformed (non-zip) payload before prompting for a folder', async () => {
    const result = await invoke('fs:importBundle', strToU8('not a zip'));
    expect(result).toEqual({ ok: false, reason: 'malformed-zip' });
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it('rejects a non-binary payload before prompting for a folder', async () => {
    const result = await invoke('fs:importBundle', { bytes: 'not-a-typed-array' });
    expect(result).toEqual({ ok: false, reason: 'malformed-zip' });
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it('returns canceled when the folder picker is dismissed', async () => {
    const zip = packBundle([{ path: 'a.js', bytes: strToU8('1') }], {
      createdAt: '2026-05-30T00:00:00.000Z',
    });
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await invoke('fs:importBundle', zip)).toEqual({ canceled: true });
  });
});

// RL-102 hardening — the approved-scope intersection that gates the git
// read-only IPC layer (src/main/ipc/git.ts). Exercised against the REAL
// approvals registry via the same picker flow production uses.
describe('pathIntersectsApprovedScope', () => {
  it('matches the approved root itself, its children, and its ancestors', async () => {
    const project = path.join(tmpRoot, 'monorepo', 'packages', 'app');
    await mkdir(project, { recursive: true });
    await approveRoot(project);

    // Exact root.
    expect(await pathIntersectsApprovedScope(project)).toBe(true);
    // Inside the root.
    expect(
      await pathIntersectsApprovedScope(path.join(project, 'src', 'main.ts'))
    ).toBe(true);
    // Ancestor of the root — the monorepo repoRoot case.
    expect(
      await pathIntersectsApprovedScope(path.join(tmpRoot, 'monorepo'))
    ).toBe(true);
  });

  it('rejects siblings, false prefixes, and unrelated paths', async () => {
    const project = path.join(tmpRoot, 'proj');
    await mkdir(project, { recursive: true });
    await approveRoot(project);

    // Sibling directory.
    expect(
      await pathIntersectsApprovedScope(path.join(tmpRoot, 'other'))
    ).toBe(false);
    // False prefix: projextra starts with proj but is not inside it.
    expect(
      await pathIntersectsApprovedScope(path.join(tmpRoot, 'projextra'))
    ).toBe(false);
    // Entirely unrelated repo elsewhere on disk.
    expect(await pathIntersectsApprovedScope('/somewhere/else/repo')).toBe(
      false
    );
  });

  it('rejects everything when nothing has been approved', async () => {
    expect(await pathIntersectsApprovedScope(tmpRoot)).toBe(false);
  });
});
