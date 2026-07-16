import type { PropsWithChildren } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../src/renderer/components/Layout/AppLayout';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useResultStore } from '../../src/renderer/stores/resultStore';

let compactShell = false;
let editorTabs: unknown[] = [];
let activeTabId: string | null = null;
let workspaceCrashRegion: 'notebook' | 'sql' | 'http' | 'utilities' | null = null;
const setTabCompareEnabledMock = vi.fn();
const setTabVariableInspectorEnabledMock = vi.fn();
const matchMediaListeners = new Set<(event: MediaQueryListEvent) => void>();

function setCompactShell(nextValue: boolean) {
  compactShell = nextValue;
  const event = {
    matches: compactShell,
    media: '(max-width: 1179px)',
  } as MediaQueryListEvent;

  matchMediaListeners.forEach(listener => listener(event));
}

function throwForArmedWorkspace(region: Exclude<typeof workspaceCrashRegion, null>) {
  if (workspaceCrashRegion === region) {
    throw new Error(`intentional ${region} workspace test crash`);
  }
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
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: vi.fn(),
  }),
}));

vi.mock('../../src/renderer/components/Toolbar', () => ({
  Toolbar: () => (
    <button type="button" data-testid="toolbar-toggle" title="Toggle sidebar (Cmd+B)">
      Toolbar
    </button>
  ),
}));

// RL-093 — FloatingActionPill is mounted by AppLayout and transitively
// imports `useRunner` → `nodeRunner` → `esbuild-wasm`, which fails to
// initialise under jsdom. Stub it out — its behaviour is covered by
// its own component tests.
vi.mock('../../src/renderer/components/Toolbar/FloatingActionPill', () => ({
  FloatingActionPill: ({
    onOpenQuickOpen,
    onOpenPalette,
    onOpenSnippets,
    onOpenUtilities,
    utilitiesOpen,
  }: {
    onOpenQuickOpen?: () => void;
    onOpenPalette?: () => void;
    onOpenSnippets?: () => void;
    onOpenUtilities?: () => void;
    utilitiesOpen?: boolean;
  }) => (
    <div data-testid="floating-action-pill">
      <button type="button" data-testid="action-pill-quick-open" onClick={onOpenQuickOpen}>
        Quick Open
      </button>
      <button type="button" data-testid="action-pill-search" onClick={onOpenPalette}>
        Palette
      </button>
      <button type="button" data-testid="action-pill-snippets" onClick={onOpenSnippets}>
        Snippets
      </button>
      <button
        type="button"
        data-testid="action-pill-utilities"
        aria-pressed={utilitiesOpen}
        onClick={onOpenUtilities}
      >
        Utilities
      </button>
    </div>
  ),
}));

vi.mock('../../src/renderer/components/FileTree', () => ({
  FileTree: ({ onNavigate }: { onNavigate?: () => void }) => (
    <div data-testid="file-tree">
      File tree
      <button type="button" data-testid="file-tree-action">
        Tree action
      </button>
      <button type="button" data-testid="file-tree-navigate" onClick={() => onNavigate?.()}>
        Navigate
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

vi.mock('../../src/renderer/components/BrowserPreview', () => ({
  BrowserPreviewPanel: () => <div data-testid="browser-preview-panel">Browser preview</div>,
}));

// RL-039 Slice B — mock the Recipe Run panel to avoid pulling
// `runnerManager` (and its esbuild-wasm transitive dep, which jsdom
// rejects with the `TextEncoder().encode("") instanceof Uint8Array`
// invariant) into the AppLayout test harness. The conditional render
// gating in AppLayout itself is exercised by the same test.
vi.mock('../../src/renderer/components/Recipes/RecipeRunPanel', () => ({
  RecipeRunPanel: () => <div data-testid="recipe-run-panel">Recipe Run + Test</div>,
}));

vi.mock('../../src/renderer/components/Notebook/NotebookView', () => ({
  NotebookView: ({ tabId }: { tabId: string }) => {
    throwForArmedWorkspace('notebook');
    return (
      <div data-testid="notebook-view" data-tab-id={tabId}>
        Notebook view
      </div>
    );
  },
}));

vi.mock('../../src/renderer/components/SqlWorkspace/SqlWorkspaceView', () => ({
  SqlWorkspaceView: ({ tabId }: { tabId: string }) => {
    throwForArmedWorkspace('sql');
    return (
      <div data-testid="sql-workspace-panel" data-tab-id={tabId}>
        SQL workspace
      </div>
    );
  },
}));

vi.mock('../../src/renderer/components/HttpWorkspace/HttpWorkspaceView', () => ({
  HttpWorkspaceView: ({ tabId }: { tabId: string }) => {
    throwForArmedWorkspace('http');
    return (
      <div data-testid="http-workspace-panel" data-tab-id={tabId}>
        HTTP workspace
      </div>
    );
  },
}));

vi.mock('../../src/renderer/components/DeveloperUtilities', () => ({
  DeveloperUtilitiesWorkspaceView: ({ active }: { active: boolean }) => {
    throwForArmedWorkspace('utilities');
    return (
      <div data-testid="developer-utilities-workspace" data-active={active}>
        Developer Utilities
      </div>
    );
  },
}));

vi.mock('../../src/renderer/components/Editor/CodeEditor', () => ({
  CodeEditor: () => <div data-testid="code-editor">Code editor</div>,
}));

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (
    selector?: (state: {
      tabs: unknown[];
      activeTabId: string | null;
      setTabCompareEnabled: typeof setTabCompareEnabledMock;
      setTabVariableInspectorEnabled: typeof setTabVariableInspectorEnabledMock;
    }) => unknown
  ) => {
    const state = {
      tabs: editorTabs,
      activeTabId,
      setTabCompareEnabled: setTabCompareEnabledMock,
      setTabVariableInspectorEnabled: setTabVariableInspectorEnabledMock,
    };
    return selector ? selector(state) : state;
  },
  getActiveTab: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.tabs.find(t => t.id === s.activeTabId) ?? null,
  getActiveTabIndex: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.activeTabId == null ? -1 : s.tabs.findIndex(t => t.id === s.activeTabId),
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
    editorTabs = [];
    activeTabId = null;
    workspaceCrashRegion = null;
    setTabCompareEnabledMock.mockReset();
    setTabVariableInspectorEnabledMock.mockReset();
    matchMediaListeners.clear();
    useResultStore.setState({ scopeSnapshot: null, snapshotRing: [] });

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return compactShell;
      },
      media: query,
      onchange: null,
      addEventListener: (_eventName: string, listener: (event: MediaQueryListEvent) => void) => {
        matchMediaListeners.add(listener);
      },
      removeEventListener: (_eventName: string, listener: (event: MediaQueryListEvent) => void) => {
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
    useSettingsStore.setState({
      layoutPreset: 'horizontal',
      variableInspectorSurface: 'floating',
    });
  });

  it('renders the explorer as a persistent sidebar on wide shells', async () => {
    await renderLayout();

    expect(screen.queryByRole('dialog', { name: 'Project explorer' })).toBeNull();
    expect(document.querySelector('[data-panel="sidebar-panel"]')).toBeTruthy();
    expect(screen.getByTestId('file-tree')).toBeTruthy();
  });

  it('wires toolbar overlay action icons through the layout boundary', async () => {
    const user = userEvent.setup();
    const onOpenQuickOpen = vi.fn();
    const onOpenPalette = vi.fn();
    const onOpenSnippets = vi.fn();
    const onOpenUtilities = vi.fn();

    render(
      <AppLayout
        onOpenQuickOpen={onOpenQuickOpen}
        onOpenPalette={onOpenPalette}
        onOpenSnippets={onOpenSnippets}
        onOpenUtilities={onOpenUtilities}
        utilitiesOpen
      />
    );
    await screen.findByTestId('code-editor');

    await user.click(screen.getByTestId('action-pill-quick-open'));
    await user.click(screen.getByTestId('action-pill-search'));
    await user.click(screen.getByTestId('action-pill-snippets'));
    const utilitiesButton = screen.getByTestId('action-pill-utilities');
    expect(utilitiesButton.getAttribute('aria-pressed')).toBe('true');
    await user.click(utilitiesButton);

    expect(onOpenQuickOpen).toHaveBeenCalledOnce();
    expect(onOpenPalette).toHaveBeenCalledOnce();
    expect(onOpenSnippets).toHaveBeenCalledOnce();
    expect(onOpenUtilities).toHaveBeenCalledOnce();
  });

  it('keeps the sidebar toggle visible in the editor header row', async () => {
    const user = userEvent.setup();
    editorTabs = [{ id: 'tab-1' }];
    activeTabId = 'tab-1';
    useUIStore.setState({ sidebarVisible: false });

    await renderLayout();

    const toggle = screen.getByTestId('editor-sidebar-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await user.click(toggle);

    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  it('keeps the editor panel above the results panel for Monaco overlays', async () => {
    editorTabs = [{ id: 'tab-1' }];

    await renderLayout();

    const editorPanel = document.querySelector<HTMLElement>('[data-panel="editor-panel"]');
    const resultsPanel = document.querySelector<HTMLElement>('[data-panel="results-panel"]');
    const editorResultsGroup = editorPanel?.parentElement;

    expect(editorResultsGroup?.className).toContain('relative');
    expect(editorResultsGroup?.className).toContain('overflow-visible');
    expect(editorPanel?.className).toContain('relative');
    expect(editorPanel?.className).toContain('z-20');
    expect(editorPanel?.className).toContain('overflow-visible');
    expect(resultsPanel?.className).toContain('relative');
    expect(resultsPanel?.className).toContain('z-10');
    expect(resultsPanel?.className).toContain('overflow-hidden');
  });

  it('shows the Browser preview panel for an active browser-preview tab even when console is closed', async () => {
    editorTabs = [
      {
        id: 'preview-tab',
        language: 'javascript',
        runtimeMode: 'browser-preview',
      },
    ];
    activeTabId = 'preview-tab';
    useUIStore.setState({
      sidebarVisible: false,
      consoleVisible: false,
      activeBottomPanel: 'console',
    });

    await renderLayout();

    expect(screen.getByTestId('bottom-panel-browser-preview-tab')).toBeTruthy();
    expect(screen.getByTestId('browser-preview-panel')).toBeTruthy();
    expect(screen.queryByTestId('console-panel')).toBeNull();
  });

  it('shows the Recipe panel for an active tab with a persisted recipe binding', async () => {
    editorTabs = [
      {
        id: 'recipe-tab',
        language: 'javascript',
        recipeBindingId: 'js-sort-objects',
      },
    ];
    activeTabId = 'recipe-tab';
    useUIStore.setState({
      sidebarVisible: false,
      consoleVisible: false,
      activeBottomPanel: 'recipe',
    });

    await renderLayout();

    expect(screen.getByTestId('bottom-panel-recipe-tab')).toBeTruthy();
    expect(screen.getByTestId('recipe-run-panel')).toBeTruthy();
  });

  it('opens bottom Variables instead of disabling an already-enabled inspector chip', async () => {
    const user = userEvent.setup();
    editorTabs = [
      {
        id: 'tab-js',
        language: 'javascript',
        runtimeMode: 'worker',
        variableInspectorEnabled: true,
      },
    ];
    activeTabId = 'tab-js';
    useSettingsStore.setState({ variableInspectorSurface: 'bottom' });
    useResultStore.setState({
      scopeSnapshot: {
        language: 'javascript',
        capturedAt: 1,
        variables: [
          {
            name: 'value',
            value: { kind: 'primitive', type: 'number', repr: '1' },
          },
        ],
      },
    });
    useUIStore.setState({
      sidebarVisible: false,
      consoleVisible: false,
      activeBottomPanel: 'console',
    });

    await renderLayout();
    await user.click(screen.getByTestId('panel-chip-variables'));

    expect(setTabVariableInspectorEnabledMock).toHaveBeenCalledWith('tab-js', true);
    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'variables',
      consoleVisible: true,
    });
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

    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
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
    const closeButton = screen.getByRole('button', { name: 'Close sidebar' });
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

    const closeButton = screen.getByRole('button', { name: 'Close sidebar' });
    const treeAction = screen.getByTestId('file-tree-action');
    const navigateAction = screen.getByTestId('file-tree-navigate');

    await waitFor(() => {
      expect(document.activeElement).toBe(closeButton);
    });

    await user.tab();
    expect(document.activeElement).toBe(treeAction);

    await user.tab();
    expect(document.activeElement).toBe(navigateAction);

    await user.tab();
    expect(document.activeElement).toBe(closeButton);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(navigateAction);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(treeAction);
  });

  it('moves focus back into the persistent explorer and clears modal state when the shell widens', async () => {
    const user = userEvent.setup();
    setCompactShell(true);

    await renderLayout();

    const shellUnderlay = screen.getByTestId('shell-underlay');
    const treeAction = screen.getByTestId('file-tree-action');

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close sidebar' }));
    });

    await user.tab();
    expect(document.activeElement).toBe(treeAction);
    expect(shellUnderlay.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      setCompactShell(false);
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Project explorer' })).toBeNull();
    });
    await waitFor(() => {
      expect(document.querySelector('[data-panel="sidebar-panel"]')).toBeTruthy();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('file-tree-action'));
    });
    expect(shellUnderlay.hasAttribute('inert')).toBe(false);
    expect(shellUnderlay.getAttribute('aria-hidden')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes the compact drawer when the explorer triggers navigation', async () => {
    const user = userEvent.setup();
    setCompactShell(true);

    await renderLayout();

    expect(screen.getByRole('dialog', { name: 'Project explorer' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByTestId('file-tree-navigate'));

    await waitFor(() => {
      expect(useUIStore.getState().sidebarVisible).toBe(false);
    });
    expect(screen.queryByRole('dialog', { name: 'Project explorer' })).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('shares one header row with the Utilities pills and folds the console on a utilities tab', async () => {
    editorTabs = [{ id: 'utilities-tab', kind: 'utilities', language: 'javascript' }];
    activeTabId = 'utilities-tab';
    useUIStore.getState().setConsoleVisible(true);

    render(<AppLayout />);
    await screen.findByTestId('developer-utilities-workspace');

    // The Utilities pills join the SHARED editor chips row (no second
    // workspace-local header row).
    const chipsRow = screen.getByRole('toolbar', { name: 'Editor panels' });
    await waitFor(() => {
      expect(chipsRow.textContent).toContain('Copy output');
      expect(chipsRow.textContent).toMatch(/\d+ tools/u);
    });

    // Utilities has no runtime output: activating the tab folds the
    // console down to the restore strip without destroying its state.
    await waitFor(() => {
      expect(useUIStore.getState().consoleVisible).toBe(false);
    });
    expect(screen.queryByTestId('console-panel')).toBeNull();
    expect(screen.getByTestId('bottom-panel-restore')).toBeTruthy();
  });

  it.each([
    ['notebook', 'notebook-view'],
    ['sql', 'sql-workspace-panel'],
    ['http', 'http-workspace-panel'],
    ['utilities', 'developer-utilities-workspace'],
  ] as const)(
    'contains a %s render crash, records its region, and retries without unmounting the shell',
    async (region, recoveredTestId) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      editorTabs = [{ id: `${region}-tab`, kind: region, language: 'javascript' }];
      activeTabId = `${region}-tab`;
      workspaceCrashRegion = region;

      try {
        render(<AppLayout />);
        const fallback = await screen.findByTestId(`error-boundary-${region}`);

        expect(fallback.getAttribute('data-region')).toBe(region);
        expect(screen.getByTestId('editor-tabs')).toBeTruthy();
        expect(screen.getByTestId('toolbar-toggle')).toBeTruthy();
        const crashLog = JSON.parse(localStorage.getItem('lingua-crash-log') ?? '[]') as Array<{
          region?: string;
        }>;
        expect(crashLog.at(-1)?.region).toBe(region);

        workspaceCrashRegion = null;
        fireEvent.click(screen.getByTestId(`error-boundary-${region}-retry`));

        await screen.findByTestId(recoveredTestId);
        expect(screen.queryByTestId(`error-boundary-${region}`)).toBeNull();
        expect(screen.getByTestId('editor-tabs')).toBeTruthy();
      } finally {
        consoleError.mockRestore();
      }
    }
  );
});
