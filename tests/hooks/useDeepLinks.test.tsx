import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeepLinks } from '@/hooks/useDeepLinks';
import { useEditorStore } from '@/stores/editorStore';
import { useSnippetsStore } from '@/stores/snippetsStore';

function Harness({ openOverlay }: { openOverlay: (overlay: 'snippets') => void }) {
  useDeepLinks({ openOverlay });
  return null;
}

describe('useDeepLinks', () => {
  const onLinkHandlers: Array<(target: DeepLinkTarget) => void> = [];
  const markReady = vi.fn();
  const consumePending = vi.fn<() => Promise<DeepLinkTarget | null>>();
  const openOverlay = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onLinkHandlers.length = 0;

    useEditorStore.setState({ tabs: [], activeTabId: null });
    useSnippetsStore.setState({ snippets: [], pendingLinkedSnippetId: null });

    Object.defineProperty(window, 'lingua', {
      value: {
        fs: {
          read: vi.fn().mockResolvedValue('const deep = true;\n'),
          reopenFile: vi.fn().mockResolvedValue({
            ok: true,
            rootId: 'root-deep',
            rootPath: '/tmp',
            fileRelativePath: 'demo.ts',
          }),
          reopenRoot: vi.fn(),
          revokeRoot: vi.fn().mockResolvedValue(true),
        },
        deepLinks: {
          markReady,
          consumePending,
          onLink: (callback: (target: DeepLinkTarget) => void) => {
            onLinkHandlers.push(callback);
            return () => {
              const index = onLinkHandlers.indexOf(callback);
              if (index >= 0) {
                onLinkHandlers.splice(index, 1);
              }
            };
          },
        },
      },
      configurable: true,
      writable: true,
    });
  });

  it('opens a pending file deep link on mount', async () => {
    consumePending.mockResolvedValue({
      kind: 'open-file',
      filePath: '/tmp/demo.ts',
      rawUrl: 'lingua://open?file=/tmp/demo.ts',
    });

    render(<Harness openOverlay={openOverlay} />);

    await waitFor(() => {
      expect(markReady).toHaveBeenCalled();
      expect(useEditorStore.getState().tabs[0]).toEqual(
        expect.objectContaining({
          filePath: '/tmp/demo.ts',
          name: 'demo.ts',
          language: 'typescript',
          content: 'const deep = true;\n',
        })
      );
    });
  });

  it('creates a new tab for pending new-file links', async () => {
    consumePending.mockResolvedValue({
      kind: 'new-file',
      language: 'python',
      rawUrl: 'lingua://new?lang=python',
    });

    render(<Harness openOverlay={openOverlay} />);

    await waitFor(() => {
      expect(useEditorStore.getState().tabs[0]).toEqual(
        expect.objectContaining({
          language: 'python',
          name: expect.stringMatching(/^untitled-.*\.py$/),
        })
      );
    });
  });

  it('opens the snippets overlay for runtime snippet links', async () => {
    consumePending.mockResolvedValue(null);

    render(<Harness openOverlay={openOverlay} />);

    await act(async () => {
      onLinkHandlers[0]?.({
        kind: 'open-snippet',
        snippetId: 'snippet-99',
        rawUrl: 'lingua://snippet?id=snippet-99',
      });
    });

    await waitFor(() => {
      expect(openOverlay).toHaveBeenCalledWith('snippets');
      expect(useSnippetsStore.getState().pendingLinkedSnippetId).toBe('snippet-99');
    });
  });

  it('swallows file-open failures without leaving unhandled deep-link state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    consumePending.mockResolvedValue({
      kind: 'open-file',
      filePath: '/tmp/missing.ts',
      rawUrl: 'lingua://open?file=/tmp/missing.ts',
    });
    window.lingua.fs.read = vi.fn().mockRejectedValue(new Error('missing'));

    render(<Harness openOverlay={openOverlay} />);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        '[deep-links] Failed to handle deep link',
        {
          kind: 'open-file',
          filePath: '/tmp/missing.ts',
          rawUrl: 'lingua://open?file=/tmp/missing.ts',
        },
        expect.any(Error)
      );
    });

    consoleError.mockRestore();
  });
});
