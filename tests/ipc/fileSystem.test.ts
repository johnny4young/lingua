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
