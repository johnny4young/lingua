import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectBundle } from '../../src/renderer/hooks/useProjectBundle';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useProjectStore } from '../../src/renderer/stores/projectStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const initialProjectState = useProjectStore.getState();
const initialEditorState = useEditorStore.getState();
const initialUiState = useUIStore.getState();

describe('useProjectBundle', () => {
  let originalLingua: typeof window.lingua;

  beforeEach(() => {
    originalLingua = window.lingua;
    useProjectStore.setState(initialProjectState, true);
    useEditorStore.setState(initialEditorState, true);
    useUIStore.setState(initialUiState, true);
  });

  afterEach(() => {
    window.lingua = originalLingua;
    useProjectStore.setState(initialProjectState, true);
    useEditorStore.setState(initialEditorState, true);
    useUIStore.setState(initialUiState, true);
    vi.restoreAllMocks();
  });

  function installImportBundle(
    importBundle: ReturnType<typeof vi.fn>
  ): void {
    window.lingua = {
      ...(originalLingua ?? {}),
      platform: 'desktop',
      fs: {
        ...(originalLingua?.fs ?? {}),
        importBundle,
      } as typeof window.lingua.fs,
    } as typeof window.lingua;
  }

  it('opens the manifest entry only after the imported root is adopted', async () => {
    installImportBundle(
      vi.fn().mockResolvedValue({
        ok: true,
        rootPath: '/imported',
        fileCount: 1,
        entryFile: 'index.js',
      })
    );

    const openProject = vi.fn(async () => {
      useProjectStore.setState({
        currentProject: {
          id: '/imported',
          name: 'imported',
          rootId: 'root-imported',
          rootPath: '/imported',
          openedAt: 1,
        },
      });
    });
    const openFile = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ openProject });
    useEditorStore.setState({ openFile });

    const { result } = renderHook(() => useProjectBundle());
    await act(async () => {
      await result.current.importProjectBundle(new Uint8Array([1]));
    });

    expect(openProject).toHaveBeenCalledWith('/imported');
    expect(openFile).toHaveBeenCalledWith(
      'root-imported',
      'index.js',
      'index.js',
      'javascript',
      '/imported/index.js'
    );
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'projectBundle.import.success'
    );
  });

  it('does not open a same-named entry from a stale previous project', async () => {
    installImportBundle(
      vi.fn().mockResolvedValue({
        ok: true,
        rootPath: '/imported',
        fileCount: 1,
        entryFile: 'index.js',
      })
    );

    const openProject = vi.fn().mockResolvedValue(undefined);
    const openFile = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      currentProject: {
        id: '/previous',
        name: 'previous',
        rootId: 'root-previous',
        rootPath: '/previous',
        openedAt: 1,
      },
      openProject,
    });
    useEditorStore.setState({ openFile });

    const { result } = renderHook(() => useProjectBundle());
    await act(async () => {
      await result.current.importProjectBundle(new Uint8Array([1]));
    });

    expect(openProject).toHaveBeenCalledWith('/imported');
    expect(openFile).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'projectBundle.import.failed'
    );
  });
});
