import type { PropsWithChildren } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../src/renderer/components/Layout/AppLayout';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

let compactShell = false;
const matchMediaListeners = new Set<(event: MediaQueryListEvent) => void>();

function setCompactShell(nextValue: boolean) {
  compactShell = nextValue;
  const event = {
    matches: compactShell,
    media: '(max-width: 1179px)',
  } as MediaQueryListEvent;

  matchMediaListeners.forEach((listener) => listener(event));
}

async function renderLayout() {
  render(<AppLayout />);
  await screen.findByTestId('code-editor');
}

function MockGroup({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div data-panel-group="" className={className}>
      {children}
    </div>
  );
}

function MockPanel({
  children,
  id,
  className,
}: PropsWithChildren<{ id?: string; className?: string }>) {
  return (
    <div data-panel={id} className={className}>
      {children}
    </div>
  );
}

function MockSeparator({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div data-panel-resize-handle-id="mock-handle" className={className}>
      {children}
    </div>
  );
}

vi.mock('react-resizable-panels', () => ({
  Group: MockGroup,
  Panel: MockPanel,
  Separator: MockSeparator,
}));

vi.mock('../../src/renderer/components/Toolbar', () => ({
  Toolbar: () => (
    <button type="button" data-testid="toolbar-toggle" title="Toggle sidebar (Cmd+B)">
      Toolbar
    </button>
  ),
}));

vi.mock('../../src/renderer/components/FileTree', () => ({
  FileTree: () => (
    <div data-testid="file-tree">
      File tree
      <button type="button" data-testid="file-tree-action">
        Tree action
      </button>
    </div>
  ),
}));

vi.mock('../../src/renderer/components/Editor/EditorTabs', () => ({
  EditorTabs: () => <div data-testid="editor-tabs">Tabs</div>,
}));

vi.mock('../../src/renderer/components/Editor/ResultPanel', () => ({
  ResultPanel: () => <div data-testid="result-panel">Results</div>,
}));

vi.mock('../../src/renderer/components/Console', () => ({
  ConsolePanel: () => <div data-testid="console-panel">Console</div>,
}));

vi.mock('../../src/renderer/components/Editor/CodeEditor', () => ({
  CodeEditor: () => <div data-testid="code-editor">Code editor</div>,
}));

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: { tabs: unknown[] }) => unknown) => {
    const state = { tabs: [] };
    return selector ? selector(state) : state;
  },
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<object>('lucide-react');
  return {
    ...actual,
    X: () => <span aria-hidden="true">x</span>,
  };
});

describe('AppLayout responsive shell', () => {
  beforeEach(() => {
    localStorage.clear();
    compactShell = false;
    matchMediaListeners.clear();

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return compactShell;
      },
      media: query,
      onchange: null,
      addEventListener: (_eventName: string, listener: (event: MediaQueryListEvent) => void) => {
        matchMediaListeners.add(listener);
      },
      removeEventListener: (
        _eventName: string,
        listener: (event: MediaQueryListEvent) => void
      ) => {
        matchMediaListeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => {
        matchMediaListeners.add(listener);
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        matchMediaListeners.delete(listener);
      },
      dispatchEvent: () => true,
    })) as typeof window.matchMedia;

    useUIStore.setState({ sidebarVisible: true, consoleVisible: false });
    useSettingsStore.setState({ layoutPreset: 'horizontal' });
  });

  it('renders the explorer as a persistent sidebar on wide shells', async () => {
    await renderLayout();

    expect(screen.queryByRole('dialog', { name: 'Project explorer' })).toBeNull();
    expect(document.querySelector('[data-panel="sidebar-panel"]')).toBeTruthy();
    expect(screen.getByTestId('file-tree')).toBeTruthy();
  });

  it('renders the explorer as a compact drawer on narrow shells', async () => {
    setCompactShell(true);

    await renderLayout();

    expect(screen.getByRole('dialog', { name: 'Project explorer' })).toBeTruthy();
    expect(document.querySelector('[data-panel="sidebar-panel"]')).toBeNull();
  });

  it('moves an open sidebar into the compact drawer when the shell shrinks', async () => {
    await renderLayout();
    expect(document.querySelector('[data-panel="sidebar-panel"]')).toBeTruthy();
    await waitFor(() => {
      expect(matchMediaListeners.size).toBeGreaterThan(0);
    });

    act(() => {
      setCompactShell(true);
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Project explorer' })).toBeTruthy();
    });
    expect(document.querySelector('[data-panel="sidebar-panel"]')).toBeNull();
  });

  it('lets the compact drawer close with Escape and the close button', async () => {
    const user = userEvent.setup();
    setCompactShell(true);

    await renderLayout();
    expect(screen.getByRole('dialog', { name: 'Project explorer' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(useUIStore.getState().sidebarVisible).toBe(false);
    });

    act(() => {
      useUIStore.setState({ sidebarVisible: true });
    });
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Project explorer' })).toBeTruthy();
    });

    await user.click(screen.getByTitle('Close sidebar'));
    await waitFor(() => {
      expect(useUIStore.getState().sidebarVisible).toBe(false);
    });
  });

  it('focuses the close button when the compact drawer opens and restores focus after backdrop close', async () => {
    const user = userEvent.setup();
    setCompactShell(true);
    useUIStore.setState({ sidebarVisible: false, consoleVisible: false });

    await renderLayout();

    const toggleButton = screen.getByTestId('toolbar-toggle');
    toggleButton.focus();
    expect(document.activeElement).toBe(toggleButton);

    act(() => {
      useUIStore.setState({ sidebarVisible: true });
    });

    const dialog = await screen.findByRole('dialog', { name: 'Project explorer' });
    const closeButton = screen.getByTitle('Close sidebar');
    const shellUnderlay = screen.getByTestId('shell-underlay');

    await waitFor(() => {
      expect(document.activeElement).toBe(closeButton);
    });
    expect(shellUnderlay.getAttribute('aria-hidden')).toBe('true');
    expect(shellUnderlay.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(dialog.parentElement as HTMLElement);
    await waitFor(() => {
      expect(useUIStore.getState().sidebarVisible).toBe(false);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(toggleButton);
    });
    expect(shellUnderlay.hasAttribute('inert')).toBe(false);
    expect(shellUnderlay.getAttribute('aria-hidden')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('traps keyboard focus inside the compact drawer while it is open', async () => {
    const user = userEvent.setup();
    setCompactShell(true);

    await renderLayout();

    const closeButton = screen.getByTitle('Close sidebar');
    const treeAction = screen.getByTestId('file-tree-action');

    await waitFor(() => {
      expect(document.activeElement).toBe(closeButton);
    });

    await user.tab();
    expect(document.activeElement).toBe(treeAction);

    await user.tab();
    expect(document.activeElement).toBe(closeButton);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(treeAction);
  });
});
