import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock setup — must come before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockReadFile,
  mockWriteFile,
  mockUnlink,
  mockRename,
  mockMkdir,
  mockReaddir,
  mockStat,
  mockRm,
  mockWatch,
} = vi.hoisted(() => {
  const statResult = {
    size: 0,
    isDirectory: () => false,
    isFile: () => true,
    mtime: new Date(),
    ctime: new Date(),
  };
  return {
    mockReadFile: vi.fn().mockResolvedValue('file content'),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockUnlink: vi.fn().mockResolvedValue(undefined),
    mockRename: vi.fn().mockResolvedValue(undefined),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockReaddir: vi.fn().mockResolvedValue([]),
    mockStat: vi.fn().mockResolvedValue(statResult),
    mockRm: vi.fn().mockResolvedValue(undefined),
    mockWatch: vi.fn().mockReturnValue({ close: vi.fn() }),
  };
});

// ---------------------------------------------------------------------------
// Mock electron and Node fs modules before importing fileSystem
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  dialog: {
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: undefined }),
  },
  BrowserWindow: { fromWebContents: vi.fn() },
}));

vi.mock('node:fs/promises', () => {
  const exports = {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    unlink: mockUnlink,
    rename: mockRename,
    mkdir: mockMkdir,
    readdir: mockReaddir,
    stat: mockStat,
    rm: mockRm,
  };
  return { ...exports, default: exports };
});

vi.mock('node:fs', () => ({
  watch: mockWatch,
  default: { watch: mockWatch },
}));

// Import after mocks are set up
import { registerFileSystemHandlers } from '#src/main/ipc/fileSystem';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  handlers.clear();
  registerFileSystemHandlers();
});

async function invoke(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel)!;
  return handler({} as never, ...args);
}

// ---------------------------------------------------------------------------
// fs:read
// ---------------------------------------------------------------------------

describe('fs:read security guard', () => {
  it('throws "Access denied" for /etc/passwd', async () => {
    await expect(invoke('fs:read', '/etc/passwd')).rejects.toThrow('Access denied');
  });

  it('returns content for a normal path (/tmp/test.ts)', async () => {
    const result = await invoke('fs:read', '/tmp/test.ts');
    expect(result).toBe('file content');
  });
});

// ---------------------------------------------------------------------------
// fs:write
// ---------------------------------------------------------------------------

describe('fs:write security guard', () => {
  it('throws "Access denied" for /etc/hosts', async () => {
    await expect(invoke('fs:write', '/etc/hosts', 'content')).rejects.toThrow('Access denied');
  });

  it('succeeds for a normal path', async () => {
    const result = await invoke('fs:write', '/tmp/myfile.ts', 'content');
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fs:rename
// ---------------------------------------------------------------------------

describe('fs:rename security guard (oldPath)', () => {
  it('throws "Access denied" when oldPath is /etc/passwd', async () => {
    await expect(invoke('fs:rename', '/etc/passwd', 'passwd.bak')).rejects.toThrow('Access denied');
  });
});

describe('fs:rename security guard (newPath)', () => {
  it('throws "Access denied" when oldPath resolves into a blocked directory', async () => {
    // oldPath is inside /etc, so both old and new are blocked
    await expect(invoke('fs:rename', '/etc/somefile', 'otherfile')).rejects.toThrow('Access denied');
  });

  it('rejects traversal or nested rename targets', async () => {
    await expect(invoke('fs:rename', '/tmp/somefile', '../escape')).rejects.toThrow(
      'Invalid name for rename'
    );
    await expect(invoke('fs:rename', '/tmp/somefile', 'nested/file')).rejects.toThrow(
      'Invalid name for rename'
    );
  });
});

// ---------------------------------------------------------------------------
// fs:watch-start
// ---------------------------------------------------------------------------

describe('fs:watch-start security guard', () => {
  it('throws "Access denied" for /etc', async () => {
    await expect(invoke('fs:watch-start', '/etc')).rejects.toThrow('Access denied');
  });

  it('does not throw for /tmp/myproject', async () => {
    await expect(invoke('fs:watch-start', '/tmp/myproject')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// fs:save-dialog
// ---------------------------------------------------------------------------

describe('fs:listAllFiles', () => {
  function dirent(name: string, isDir: boolean) {
    return {
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
    };
  }

  function configureFileTree(
    tree: Record<string, Array<{ name: string; isDir: boolean }>>
  ) {
    mockReaddir.mockImplementation(async (dirPath: string) => {
      return (tree[dirPath] ?? []).map((entry) => dirent(entry.name, entry.isDir));
    });
  }

  it('walks the project recursively and returns only files with relative paths', async () => {
    configureFileTree({
      '/project': [
        { name: 'README.md', isDir: false },
        { name: 'src', isDir: true },
        { name: 'node_modules', isDir: true }, // must be ignored
      ],
      '/project/src': [
        { name: 'main.ts', isDir: false },
        { name: 'utils', isDir: true },
      ],
      '/project/src/utils': [{ name: 'helpers.ts', isDir: false }],
      '/project/node_modules': [{ name: 'should-not-appear.ts', isDir: false }],
    });

    const result = await invoke('fs:listAllFiles', '/project');
    expect(result).toEqual([
      { name: 'README.md', path: '/project/README.md', relativePath: 'README.md' },
      { name: 'main.ts', path: '/project/src/main.ts', relativePath: 'src/main.ts' },
      {
        name: 'helpers.ts',
        path: '/project/src/utils/helpers.ts',
        relativePath: 'src/utils/helpers.ts',
      },
    ]);
  });

  it('rejects blocked root paths before starting the walk', async () => {
    mockReaddir.mockClear();
    await expect(invoke('fs:listAllFiles', '/etc')).rejects.toThrow('Access denied');
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('skips dotfiles that are not explicitly allowed', async () => {
    configureFileTree({
      '/project': [
        { name: '.env', isDir: false },
        { name: '.gitignore', isDir: false },
        { name: '.secret', isDir: false },
        { name: '.DS_Store', isDir: false },
      ],
    });

    const result = await invoke('fs:listAllFiles', '/project');
    const names = (result as FsIndexedFile[]).map((file) => file.name).sort();
    expect(names).toEqual(['.env', '.gitignore']);
  });

  it('swallows unreadable directories instead of aborting the whole walk', async () => {
    mockReaddir.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/project/forbidden') {
        throw new Error('EACCES');
      }
      if (dirPath === '/project') {
        return [
          dirent('ok.ts', false),
          dirent('forbidden', true),
        ];
      }
      return [];
    });

    const result = await invoke('fs:listAllFiles', '/project');
    expect(result).toEqual([
      { name: 'ok.ts', path: '/project/ok.ts', relativePath: 'ok.ts' },
    ]);
  });
});

describe('fs:searchInFiles', () => {
  function dirent(name: string, isDir: boolean) {
    return {
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
    };
  }

  function configureFileTree(
    tree: Record<string, Array<{ name: string; isDir: boolean }>>
  ) {
    mockReaddir.mockImplementation(async (dirPath: string) => {
      return (tree[dirPath] ?? []).map((entry) => dirent(entry.name, entry.isDir));
    });
  }

  function configureFileContents(contents: Record<string, string>) {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath in contents) {
        return contents[filePath] as string;
      }
      throw new Error(`unexpected readFile: ${filePath}`);
    });
    mockStat.mockImplementation(async (filePath: string) => ({
      size: contents[filePath]?.length ?? 0,
      isDirectory: () => false,
      isFile: () => true,
      mtime: new Date(),
      ctime: new Date(),
    }));
  }

  it('returns no results for an empty query without walking the filesystem', async () => {
    mockReaddir.mockClear();
    const result = await invoke('fs:searchInFiles', '/project', '');
    expect(result).toEqual([]);
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('finds case-insensitive substring matches with preview windows', async () => {
    configureFileTree({
      '/project': [
        { name: 'main.ts', isDir: false },
        { name: 'README.md', isDir: false },
      ],
    });
    configureFileContents({
      '/project/main.ts': "const TODO = 'fix this later';\nconsole.log(todo);\n",
      '/project/README.md': 'Nothing here yet.\n',
    });

    const result = (await invoke('fs:searchInFiles', '/project', 'todo')) as FsSearchResult[];
    expect(result).toHaveLength(1);
    expect(result[0]!.relativePath).toBe('main.ts');
    expect(result[0]!.matches).toHaveLength(2);
    expect(result[0]!.matches[0]).toMatchObject({ line: 1, matchEnd: expect.any(Number) });
    expect(result[0]!.matches[1]).toMatchObject({ line: 2 });
  });

  it('skips binary files via the NUL-byte heuristic', async () => {
    configureFileTree({
      '/project': [
        { name: 'asset.bin', isDir: false },
        { name: 'code.ts', isDir: false },
      ],
    });
    configureFileContents({
      '/project/asset.bin': `${'needle'}\u0000\u0000binary payload\u0000`,
      '/project/code.ts': 'const needle = 1;\n',
    });

    const result = (await invoke('fs:searchInFiles', '/project', 'needle')) as FsSearchResult[];
    expect(result.map((entry) => entry.relativePath)).toEqual(['code.ts']);
  });

  it('rejects blocked roots before walking', async () => {
    mockReaddir.mockClear();
    await expect(invoke('fs:searchInFiles', '/etc', 'secret')).rejects.toThrow(
      'Access denied'
    );
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('caps total matches so a pathological project cannot flood the IPC channel', async () => {
    configureFileTree({
      '/project': [{ name: 'big.ts', isDir: false }],
    });
    configureFileContents({
      '/project/big.ts': 'needle\n'.repeat(500),
    });

    const result = (await invoke('fs:searchInFiles', '/project', 'needle', {
      maxTotalMatches: 3,
      maxMatchesPerFile: 10,
    })) as FsSearchResult[];
    const totalMatches = result.reduce((sum, item) => sum + item.matches.length, 0);
    expect(totalMatches).toBeLessThanOrEqual(3);
  });
});

describe('fs:save-dialog', () => {
  it('registers the handler', () => {
    expect(handlers.has('fs:save-dialog')).toBe(true);
  });

  it('returns null when user cancels', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    });

    const result = await invoke('fs:save-dialog', 'untitled.js');
    expect(result).toBeNull();
  });

  it('returns the chosen path when user confirms', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/saved.js',
    });

    const result = await invoke('fs:save-dialog', 'untitled.js');
    expect(result).toBe('/tmp/saved.js');
  });

  it('throws on blocked path', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: false,
      filePath: '/etc/evil.js',
    });

    await expect(invoke('fs:save-dialog', 'evil.js')).rejects.toThrow('Access denied');
  });
});

describe('fs:select-file', () => {
  it('limits the native picker to code and text file extensions', async () => {
    const { dialog } = await import('electron');

    await invoke('fs:select-file');

    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
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
});

// ---------------------------------------------------------------------------
// app:confirm-close
// ---------------------------------------------------------------------------

describe('app:confirm-close', () => {
  it('registers the handler', () => {
    expect(handlers.has('app:confirm-close')).toBe(true);
  });

  it('localizes the app-close dialog in Spanish', async () => {
    const { dialog } = await import('electron');

    await invoke('app:confirm-close', ['alpha.ts', 'beta.ts'], 'es');

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
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

// ---------------------------------------------------------------------------
// app:confirm-close-tab
// ---------------------------------------------------------------------------

describe('app:confirm-close-tab', () => {
  it('registers the handler', () => {
    expect(handlers.has('app:confirm-close-tab')).toBe(true);
  });

  it('localizes the dirty-tab dialog in English', async () => {
    const { dialog } = await import('electron');

    await invoke('app:confirm-close-tab', 'draft.ts', 'en');

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
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

// ---------------------------------------------------------------------------
// fs:delete
// ---------------------------------------------------------------------------

describe('fs:delete confirmation dialog', () => {
  it('localizes folder deletion copy in Spanish', async () => {
    const { dialog } = await import('electron');

    await invoke('fs:delete', '/tmp/demo-folder', true, 'es');

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
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
