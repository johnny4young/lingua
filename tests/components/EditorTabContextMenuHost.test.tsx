import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorTabContextMenuHost } from '@/components/Editor/EditorTabContextMenuHost';
import type { EditorTabContextMenuProps } from '@/components/Editor/editorTabContextMenuLoader';
import { resolveEditorTabContextMenuAnchor } from '@/components/Editor/editorTabContextMenuPosition';

const mocks = vi.hoisted(() => ({
  loadContextMenu: vi.fn(),
  pushErrorNotice: vi.fn(),
}));

vi.mock('@/components/Editor/editorTabContextMenuLoader', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/components/Editor/editorTabContextMenuLoader')>();
  return {
    ...actual,
    loadEditorTabContextMenu: mocks.loadContextMenu,
  };
});

vi.mock('@/hooks/useStatusNotice', () => ({
  useStatusNotice: () => ({
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: mocks.pushErrorNotice,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function ContextMenuProbe({ tabName }: EditorTabContextMenuProps) {
  return <div data-testid="editor-tab-context-menu-probe">{tabName}</div>;
}

function makeProps(overrides: Partial<EditorTabContextMenuProps> = {}): EditorTabContextMenuProps {
  return {
    anchor: { top: 40, left: 60 },
    tabName: 'main.ts',
    isLastTab: false,
    isRightmost: false,
    onClose: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseToRight: vi.fn(),
    onCloseAll: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    ...overrides,
  };
}

describe('EditorTabContextMenuHost', () => {
  beforeEach(() => {
    mocks.loadContextMenu.mockReset();
    mocks.pushErrorNotice.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the loaded menu with current props under StrictMode', async () => {
    const pending = deferred<{ EditorTabContextMenu: typeof ContextMenuProbe }>();
    mocks.loadContextMenu.mockReturnValue(pending.promise);
    const { rerender } = render(
      <StrictMode>
        <EditorTabContextMenuHost {...makeProps()} />
      </StrictMode>
    );

    expect(screen.queryByTestId('editor-tab-context-menu-probe')).toBeNull();
    rerender(
      <StrictMode>
        <EditorTabContextMenuHost {...makeProps({ tabName: 'latest.ts' })} />
      </StrictMode>
    );

    await act(async () => {
      pending.resolve({ EditorTabContextMenu: ContextMenuProbe });
    });

    expect((await screen.findByTestId('editor-tab-context-menu-probe')).textContent).toBe(
      'latest.ts'
    );
  });

  it('closes a failed request and reports the localized recovery notice', async () => {
    const error = new Error('tab context-menu chunk unavailable');
    const onClose = vi.fn();
    mocks.loadContextMenu.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<EditorTabContextMenuHost {...makeProps({ onClose })} />);

    await act(async () => undefined);

    expect(consoleError).toHaveBeenCalledWith(
      '[editor-tabs] failed to load the tab context menu',
      error
    );
    expect(mocks.pushErrorNotice).toHaveBeenCalledWith('editorTabs.menu.loadFailed');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a late module result after the menu closes', async () => {
    const pending = deferred<{ EditorTabContextMenu: typeof ContextMenuProbe }>();
    mocks.loadContextMenu.mockReturnValue(pending.promise);
    const { unmount } = render(<EditorTabContextMenuHost {...makeProps()} />);

    unmount();
    await act(async () => {
      pending.resolve({ EditorTabContextMenu: ContextMenuProbe });
    });

    expect(screen.queryByTestId('editor-tab-context-menu-probe')).toBeNull();
  });

  it('keeps the complete menu footprint inside the viewport', () => {
    expect(
      resolveEditorTabContextMenuAnchor({ top: 790, left: 990 }, { width: 1_000, height: 800 })
    ).toEqual({ top: 536, left: 764 });
    expect(
      resolveEditorTabContextMenuAnchor({ top: -10, left: -20 }, { width: 1_000, height: 800 })
    ).toEqual({ top: 12, left: 12 });
  });
});
