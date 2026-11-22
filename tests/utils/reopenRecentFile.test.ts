import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecentFilesStore } from '../../src/renderer/stores/recentFilesStore';
import { reopenRecentFile } from '../../src/renderer/utils/reopenRecentFile';

const reopenFile = vi.fn();
const original = window.lingua;

describe('reopenRecentFile', () => {
  beforeEach(() => {
    reopenFile.mockReset();
    Object.defineProperty(window, 'lingua', { configurable: true, value: { fs: { reopenFile } } });
    useRecentFilesStore.setState({
      recentFiles: [{ filePath: '/gone.py', name: 'gone.py', language: 'python', openedAt: 1 }],
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'lingua', { configurable: true, value: original });
  });

  it('opens the approved file in a tab', async () => {
    reopenFile.mockResolvedValue({ ok: true, rootId: 'r', rootPath: '/', fileRelativePath: 'gone.py' });
    const openFile = vi.fn().mockResolvedValue(undefined);
    await reopenRecentFile({ path: '/gone.py', name: 'gone.py', language: 'python' }, openFile);
    expect(openFile).toHaveBeenCalledWith('r', 'gone.py', 'gone.py', 'python', '/gone.py');
  });

  it.each(['not-found', 'not-a-file'] as const)('drops a recent file the reopen reports as %s', async error => {
    reopenFile.mockResolvedValue({ ok: false, error });
    const openFile = vi.fn();
    await reopenRecentFile({ path: '/gone.py', name: 'gone.py' }, openFile);
    expect(openFile).not.toHaveBeenCalled();
    expect(useRecentFilesStore.getState().recentFiles).toEqual([]);
  });

  it('keeps a recent file that only lost its approval', async () => {
    reopenFile.mockResolvedValue({ ok: false, error: 'not-approved' });
    await reopenRecentFile({ path: '/gone.py', name: 'gone.py' }, vi.fn());
    expect(useRecentFilesStore.getState().recentFiles).toHaveLength(1);
  });
});
