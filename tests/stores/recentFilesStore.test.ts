import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useRecentFilesStore } from '@/stores/recentFilesStore';

describe('recentFilesStore', () => {
  const initialState = useRecentFilesStore.getState();

  beforeEach(() => {
    useRecentFilesStore.setState(initialState, true);
    localStorage.clear();
  });

  afterEach(() => {
    useRecentFilesStore.setState(initialState, true);
    localStorage.clear();
  });

  it('should start with an empty recent files list', () => {
    expect(useRecentFilesStore.getState().recentFiles).toHaveLength(0);
  });

  it('should add a recent file', () => {
    useRecentFilesStore.getState().addRecentFile({
      filePath: '/path/to/file.js',
      name: 'file.js',
      language: 'javascript',
    });

    const { recentFiles } = useRecentFilesStore.getState();
    expect(recentFiles).toHaveLength(1);
    expect(recentFiles[0].filePath).toBe('/path/to/file.js');
    expect(recentFiles[0].name).toBe('file.js');
    expect(recentFiles[0].language).toBe('javascript');
    expect(recentFiles[0].openedAt).toBeGreaterThan(0);
  });

  it('should deduplicate by filePath, moving the entry to the top', () => {
    const { addRecentFile } = useRecentFilesStore.getState();
    addRecentFile({ filePath: '/a.js', name: 'a.js', language: 'javascript' });
    addRecentFile({ filePath: '/b.py', name: 'b.py', language: 'python' });
    addRecentFile({ filePath: '/a.js', name: 'a.js', language: 'javascript' });

    const { recentFiles } = useRecentFilesStore.getState();
    expect(recentFiles).toHaveLength(2);
    expect(recentFiles[0].filePath).toBe('/a.js');
    expect(recentFiles[1].filePath).toBe('/b.py');
  });

  it('should keep a maximum of 20 entries', () => {
    const { addRecentFile } = useRecentFilesStore.getState();
    for (let i = 0; i < 25; i++) {
      addRecentFile({
        filePath: `/file-${i}.ts`,
        name: `file-${i}.ts`,
        language: 'typescript',
      });
    }

    expect(useRecentFilesStore.getState().recentFiles).toHaveLength(20);
    // Most recent should be first
    expect(useRecentFilesStore.getState().recentFiles[0].filePath).toBe('/file-24.ts');
  });

  it('should remove a recent file by filePath', () => {
    const { addRecentFile } = useRecentFilesStore.getState();
    addRecentFile({ filePath: '/keep.js', name: 'keep.js', language: 'javascript' });
    addRecentFile({ filePath: '/remove.js', name: 'remove.js', language: 'javascript' });

    useRecentFilesStore.getState().removeRecentFile('/remove.js');

    const { recentFiles } = useRecentFilesStore.getState();
    expect(recentFiles).toHaveLength(1);
    expect(recentFiles[0].filePath).toBe('/keep.js');
  });

  it('should clear all recent files', () => {
    const { addRecentFile } = useRecentFilesStore.getState();
    addRecentFile({ filePath: '/a.js', name: 'a.js', language: 'javascript' });
    addRecentFile({ filePath: '/b.js', name: 'b.js', language: 'javascript' });

    useRecentFilesStore.getState().clearRecentFiles();
    expect(useRecentFilesStore.getState().recentFiles).toHaveLength(0);
  });
});
