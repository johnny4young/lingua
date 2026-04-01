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
