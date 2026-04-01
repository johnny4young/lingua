/**
 * Tests for web/fs-adapter.ts
 *
 * The File System Access API is not available in jsdom, so we mock the
 * relevant globals (showDirectoryPicker, showOpenFilePicker) and the
 * FileSystemDirectoryHandle / FileSystemFileHandle interfaces.
 *
 * We test the no-op paths and the adapter logic independently.
 */

import { describe, it, expect } from 'vitest';

// ---- Mock File helpers (not exercising real browser FS) ----------------

describe('webFsAdapter — watchStart / watchStop no-ops', async () => {
  // Import after env is set up
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('watchStart returns a string id', async () => {
    const id = await webFsAdapter.watchStart('/some/dir');
    expect(typeof id).toBe('string');
  });

  it('watchStop returns true', async () => {
    const result = await webFsAdapter.watchStop('web-noop-watcher');
    expect(result).toBe(true);
  });

  it('onChanged returns an unsubscribe function', () => {
    const unsub = webFsAdapter.onChanged(() => {});
    expect(typeof unsub).toBe('function');
    // Calling unsubscribe should not throw
    expect(() => unsub()).not.toThrow();
  });
});

describe('webFsAdapter — selectDirectory cancellation', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('returns null when picker throws (user cancelled)', async () => {
    // showDirectoryPicker is not in jsdom — it will throw, which the adapter
    // catches and returns null.
    const result = await webFsAdapter.selectDirectory();
    expect(result).toBeNull();
  });
});

describe('webFsAdapter — selectFile cancellation', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('returns null when picker throws (user cancelled)', async () => {
    const result = await webFsAdapter.selectFile();
    expect(result).toBeNull();
  });
});

describe('webFsAdapter — readdir with no root', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('returns empty array when no root handle is set', async () => {
    const entries = await webFsAdapter.readdir('/nonexistent');
    expect(entries).toEqual([]);
  });
});

describe('webFsAdapter — stat with no root', async () => {
  const { webFsAdapter } = await import('../../src/web/fs-adapter');

  it('throws when path cannot be resolved', async () => {
    await expect(webFsAdapter.stat('/nonexistent/file.ts')).rejects.toThrow();
  });
});
