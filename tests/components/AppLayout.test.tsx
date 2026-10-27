import type { PropsWithChildren } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../src/renderer/components/Layout/AppLayout';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import { useProjectStore } from '../../src/renderer/stores/projectStore';
import { asRootId } from '../../src/shared/fs/brandedIds';

let compactShell = false;
let editorTabs: unknown[] = [];
let activeTabId: string | null = null;
let workspaceCrashRegion: 'notebook' | 'sql' | 'http' | 'utilities' | null = null;
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

// FloatingActionPill is mounted by AppLayout and transitively
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

vi.mock('../../src/renderer/components/FileTree/FileTreeHost', () => ({
  FileTreeHost: ({ onNavigate }: { onNavigate?: () => void }) => (
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

vi.mock('../../src/renderer/components/Console', () => ({
  ConsolePanel: () => <div data-testid="console-panel">Console</div>,
}));

vi.mock('../../src/renderer/components/BrowserPreview', () => ({
  BrowserPreviewPanel: () => <div data-testid="browser-preview-panel">Browser preview</div>,
}));

vi.mock('../../src/renderer/components/ProjectTerminal/ProjectTerminalPanel', () => ({
  ProjectTerminalPanel: ({ binding }: { binding: { projectName: string } }) => (
    <div data-testid="project-terminal-panel">Terminal for {binding.projectName}</div>
  ),
}));

// Mock the Recipe Run panel to avoid pulling
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
      setTabVariableInspectorEnabled: typeof setTabVariableInspectorEnabledMock;
    }) => unknown
  ) => {
    const state = {
      tabs: editorTabs,
      activeTabId,
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
    setTabVariableInspectorEnabledMock.mockReset();
    matchMediaListeners.clear();
    useResultStore.setState({ scopeSnapshot: null, snapshotRing: [] });
    useProjectStore.setState({ currentProject: null, nodes: [] });

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
    expect(screen.getByTestId('floating-action-pill')).toBeTruthy();
    expect(screen.queryByTestId('toolbar-toggle')).toBeNull();
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

  it('gives the editor the full width and puts every output in one dock', async () => {
    editorTabs = [{ id: 'tab-1', language: 'javascript' }];
    activeTabId = 'tab-1';
    useUIStore.setState({ sidebarVisible: false, consoleVisible: true, activeBottomPanel: 'console' });

    await renderLayout();

    expect(document.querySelector('[data-panel="results-panel"]')).toBeNull();
    expect(await screen.findByTestId('results-dock')).toBeTruthy();
    expect(screen.getByTestId('bottom-panel-console-tab').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('console-panel')).toBeTruthy();
  });

  it('folds the dock to its tab row and reopens it from a tab', async () => {
    const user = userEvent.setup();
    editorTabs = [{ id: 'tab-1', language: 'javascript' }];
    activeTabId = 'tab-1';
    useUIStore.setState({ sidebarVisible: false, consoleVisible: false, activeBottomPanel: 'console' });

    await renderLayout();

    expect((await screen.findByTestId('results-dock')).getAttribute('data-expanded')).toBe('false');
    expect(screen.queryByTestId('console-panel')).toBeNull();
    expect(screen.getByTestId('bottom-panel-restore').getAttribute('aria-expanded')).toBe('false');
    await user.click(screen.getByTestId('bottom-panel-console-tab'));
    expect(useUIStore.getState().consoleVisible).toBe(true);
    expect(await screen.findByTestId('console-panel')).toBeTruthy();

    await user.click(screen.getByTestId('bottom-panel-hide'));
    expect(useUIStore.getState().consoleVisible).toBe(false);
    expect(await screen.findByTestId('bottom-panel-restore')).toBeTruthy();
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

    expect(await screen.findByTestId('bottom-panel-browser-preview-tab')).toBeTruthy();
    expect(await screen.findByTestId('browser-preview-panel')).toBeTruthy();
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
      consoleVisible: true,
      activeBottomPanel: 'recipe',
    });

    await renderLayout();

    expect(await screen.findByTestId('bottom-panel-recipe-tab')).toBeTruthy();
    expect(await screen.findByTestId('recipe-run-panel')).toBeTruthy();
  });

  it('shows the desktop project terminal as a contextual bottom panel', async () => {
    window.lingua = {
      ...(window.lingua ?? ({ platform: 'darwin' } as LinguaAPI)),
      projectTerminal: {} as NonNullable<LinguaAPI['projectTerminal']>,
    } as LinguaAPI;
    useProjectStore.setState({
      currentProject: {
        id: 'project-alpha',
        name: 'Alpha',
        rootPath: '/tmp/alpha',
        rootId: asRootId('root-alpha'),
        openedAt: 1,
      },
    });
    useUIStore.setState({
      sidebarVisible: false,
      consoleVisible: true,
      activeBottomPanel: 'project-terminal',
    });

    await renderLayout();

    expect(screen.getByTestId('bottom-panel-project-terminal-tab')).toBeTruthy();
    expect((await screen.findByTestId('project-terminal-panel')).textContent).toContain(
      'Terminal for Alpha'
    );
  });

  it('keeps the editor mounted while the dock folds and opens', async () => {
    editorTabs = [{ id: 'tab-1', language: 'javascript' }];
    activeTabId = 'tab-1';
    useUIStore.setState({ sidebarVisible: false, consoleVisible: true, activeBottomPanel: 'console' });

    await renderLayout();
    const editor = screen.getByTestId('code-editor');

    act(() => useUIStore.getState().setConsoleVisible(false));
    expect((await screen.findByTestId('results-dock')).getAttribute('data-expanded')).toBe('false');
    expect(screen.getByTestId('code-editor')).toBe(editor);

    act(() => useUIStore.getState().setConsoleVisible(true));
    expect(await screen.findByTestId('console-panel')).toBeTruthy();
    expect(screen.getByTestId('code-editor')).toBe(editor);
  });

  it('lists Variables in the dock once a capture exists and opens it', async () => {
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
    await user.click(await screen.findByTestId('bottom-panel-variables-tab'));

    expect(screen.getByTestId('bottom-panel-variables-count').textContent).toBe('1');
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

    const actionPillButton = screen.getByTestId('action-pill-search');
    actionPillButton.focus();
    expect(document.activeElement).toBe(actionPillButton);

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
      expect(document.activeElement).toBe(actionPillButton);
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

  it('puts the Utilities pills in the tab strip and drops the dock on a utilities tab', async () => {
    editorTabs = [{ id: 'utilities-tab', kind: 'utilities', language: 'javascript' }];
    activeTabId = 'utilities-tab';
    useUIStore.getState().setConsoleVisible(true);

    render(<AppLayout />);
    await screen.findByTestId('developer-utilities-workspace');

    const tabStrip = screen.getByTestId('editor-tab-strip');
    await waitFor(() => {
      expect(tabStrip.textContent).toContain('Copy output');
    });

    // Utilities has no runtime output, so the dock leaves the screen
    // without changing the user's dock preference.
    expect(screen.queryByTestId('results-dock')).toBeNull();
    expect(useUIStore.getState().consoleVisible).toBe(true);
    // Mod+B folds the tool list here, so the explorer button names no combo.
    expect(screen.getByTestId('editor-sidebar-toggle').getAttribute('aria-label')).toBe(
      'Toggle the explorer'
    );
  });

  it('keeps the Utilities workspace mounted through theme and repeated layout changes', async () => {
    editorTabs = [{ id: 'utilities-tab', kind: 'utilities', language: 'javascript' }];
    activeTabId = 'utilities-tab';
    useSettingsStore.setState({ layoutPreset: 'vertical' });

    render(<AppLayout />);
    const workspace = await screen.findByTestId('developer-utilities-workspace');

    act(() => useSettingsStore.getState().setTheme('light'));
    expect(screen.getByTestId('developer-utilities-workspace')).toBe(workspace);

    for (const layoutPreset of ['horizontal', 'vertical', 'editor-only', 'vertical', 'horizontal'] as const) {
      act(() => useSettingsStore.getState().setLayoutPreset(layoutPreset));
      expect(await screen.findByTestId('developer-utilities-workspace')).toBe(workspace);
    }
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
        expect(screen.getByTestId('floating-action-pill')).toBeTruthy();
        expect(screen.queryByTestId('toolbar-toggle')).toBeNull();
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
