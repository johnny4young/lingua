import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useDebuggerStore } from '../../src/renderer/stores/debuggerStore';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before component imports
// ---------------------------------------------------------------------------

const mockRun = vi.fn();
const mockStop = vi.fn();
const editorStoreState = {
  tabs: [
    {
      id: 'tab-1',
      name: 'untitled.js',
      language: 'javascript',
      content: '',
      isDirty: false,
    },
  ],
  activeTabId: 'tab-1',
};

let mockRunnerState = {
  run: mockRun,
  stop: mockStop,
  isRunning: false,
  isInitializing: false,
  loadingMessage: null as string | null,
  runMode: null as 'run' | 'debug' | null,
};

vi.mock('../../src/renderer/hooks/useRunner', () => ({
  useRunner: () => mockRunnerState,
}));

const {
  mockAddTab,
  mockToggleSidebar,
  mockToggleConsole,
  mockOpenFileFromDisk,
  mockPushStatusNotice,
  uiStoreState,
} = vi.hoisted(() => ({
  mockAddTab: vi.fn(),
  mockToggleSidebar: vi.fn(),
  mockToggleConsole: vi.fn(),
  mockOpenFileFromDisk: vi.fn().mockResolvedValue(undefined),
  mockPushStatusNotice: vi.fn((notice: Omit<{ id: number }, 'id'> & Record<string, unknown>) => {
    uiStoreState.statusNotice = { ...notice, id: 1 };
  }),
  uiStoreState: {
    statusNotice: null as Record<string, unknown> | null,
  },
}));

vi.mock('../../src/renderer/stores/editorStore', () => {
  const buildState = () => ({
    tabs: editorStoreState.tabs,
    activeTabId: editorStoreState.activeTabId,
    addTab: mockAddTab,
    openFileFromDisk: mockOpenFileFromDisk,
    // RL-019 Slice 1 — RuntimeModeSelector consumes this action via
    // `useEditorStore((s) => s.setTabRuntimeMode)`. Mock as a no-op
    // so the selector renders without throwing; tests that exercise
    // mode changes go through the editor-store unit suite.
    setTabRuntimeMode: vi.fn(),
    setTabWorkflowMode: vi.fn(),
  });
  // Selector-aware mock: support both `useEditorStore()` and
  // `useEditorStore((state) => state.something)` call shapes.
  const useEditorStore = (selector?: (state: ReturnType<typeof buildState>) => unknown) => {
    const state = buildState();
    return typeof selector === 'function' ? selector(state) : state;
  };
  useEditorStore.getState = () => buildState();
  return {
    useEditorStore,
    createDefaultTab: (language: string) => ({
      id: 'new-tab',
      name: `untitled.${language === 'typescript' ? 'ts' : 'js'}`,
      language,
      content: '',
      isDirty: false,
    }),
    languageFromPath: vi.fn(),
  };
});

vi.mock('../../src/renderer/stores/uiStore', () => ({
  useUIStore: Object.assign(() => ({
    sidebarVisible: true,
    consoleVisible: true,
    toggleSidebar: mockToggleSidebar,
    toggleConsole: mockToggleConsole,
    statusNotice: uiStoreState.statusNotice,
    pushStatusNotice: mockPushStatusNotice,
  }), {
    getState: () => ({
      sidebarVisible: true,
      consoleVisible: true,
      toggleSidebar: mockToggleSidebar,
      toggleConsole: mockToggleConsole,
      statusNotice: uiStoreState.statusNotice,
      pushStatusNotice: mockPushStatusNotice,
    }),
  }),
}));

vi.mock('../../src/renderer/stores/pluginStore', () => ({
  usePluginStore: (selector?: (state: { plugins: unknown[] }) => unknown) => {
    const state = { plugins: [] };
    return selector ? selector(state) : state;
  },
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Play: () => <span data-testid="icon-play">▶</span>,
  Square: () => <span data-testid="icon-stop">■</span>,
  Plus: () => null,
  ChevronDown: () => null,
  BookCopy: () => null,
  Settings: () => null,
  Loader2: () => <span data-testid="icon-loader">…</span>,
  Terminal: () => null,
  Search: () => null,
  PanelLeft: () => null,
  PanelBottom: () => null,
  FolderOpen: () => <span data-testid="icon-folder-open">📂</span>,
  Wrench: () => null,
  Bug: () => null,
  // RL-019 Slice 1 — RuntimeModeSelector consumes Cpu/Layers/Globe.
  Cpu: () => null,
  Layers: () => null,
  Globe: () => null,
  // RL-020 Slice 2 — WorkflowModeSegment consumes Sparkles for the
  // Scratchpad icon (Play + Bug are already declared above).
  Sparkles: () => null,
}));

import { Toolbar } from '../../src/renderer/components/Toolbar/Toolbar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetRunnerState(partial: Partial<typeof mockRunnerState> = {}) {
  mockRunnerState = {
    run: mockRun,
    stop: mockStop,
    isRunning: false,
    isInitializing: false,
    loadingMessage: null,
    runMode: null,
    ...partial,
  };
}

function setActiveProLicense() {
  useLicenseStore.setState({
    token: 'test.token',
    status: {
      kind: 'active',
      verification: {
        ok: true,
        state: 'active',
        supportWindowEndsAt: Date.now() + 86_400_000,
        payload: {
          productId: 'lingua-desktop',
          tier: 'pro',
          issuedTo: 'test@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Toolbar', () => {
  beforeEach(async () => {
    resetRunnerState();
    vi.clearAllMocks();
    setActiveProLicense();
    useSettingsStore.getState().resetShortcutOverrides();
    useSettingsStore.setState({ debuggerEnabled: true }, false);
    useDebuggerStore.setState(
      {
        breakpoints: {},
        breakpointOrder: [],
        watches: [],
        session: null,
        pausedFrame: null,
        drawerCollapsed: false,
      },
      false
    );
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
    uiStoreState.statusNotice = null;
    editorStoreState.tabs = [
      {
        id: 'tab-1',
        name: 'untitled.js',
        language: 'javascript',
        content: '',
        isDirty: false,
      },
    ];
    editorStoreState.activeTabId = 'tab-1';
    await i18next.changeLanguage('en');
  });

  it('renders without crashing', () => {
    render(<Toolbar />);
    expect(screen.getByTestId('toolbar-run-button')).toBeTruthy();
  });

  it('shows the Run button with "Run" accessible label when not running', () => {
    // RL-020 UI refinement — the Run button is icon-only; the label
    // moves to `aria-label` so screen readers still announce it.
    render(<Toolbar />);
    const runBtn = screen.getByTestId('toolbar-run-button');
    expect(runBtn).toBeTruthy();
    expect(runBtn.getAttribute('aria-label')).toContain('Run');
  });

  it('shows "Running..." accessible label and disables Run button when running', () => {
    resetRunnerState({ isRunning: true });
    render(<Toolbar />);
    const runBtn = screen.getByRole('button', { name: /Running/ });
    expect(runBtn.getAttribute('aria-label')).toContain('Running...');
    expect(runBtn).toHaveProperty('disabled', true);
  });

  it('shows the Stop button at all times', () => {
    resetRunnerState({ isRunning: true });
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: /Stop/ })).toBeTruthy();
  });

  it('does not render the Stop button when not running', () => {
    render(<Toolbar />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('enables the Stop button when running', () => {
    resetRunnerState({ isRunning: true });
    render(<Toolbar />);
    const stopBtn = screen.getByRole('button', { name: /Stop/ });
    expect((stopBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders an explicit new-file action for the active language', () => {
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: 'New JavaScript' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New file language menu' })).toBeTruthy();
  });

  it('keeps breakpoint state out of the top toolbar', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 4);

    render(<Toolbar />);

    expect(screen.queryByTestId('toolbar-breakpoint-pill')).toBeNull();
  });

  it('groups Debug under the Run dropdown and requires an enabled breakpoint', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByTestId('toolbar-run-menu-button'));
    const debugBtn = screen.getByTestId('toolbar-debug-button');
    expect(debugBtn.textContent).toContain('Debug');
    expect((debugBtn as HTMLButtonElement).disabled).toBe(true);
    expect(debugBtn.getAttribute('title')).toContain('Set an enabled breakpoint');
  });

  it('clicking Debug runs with explicit debug intent', async () => {
    const user = userEvent.setup();
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 4);

    render(<Toolbar />);

    await user.click(screen.getByTestId('toolbar-run-menu-button'));
    const debugBtn = screen.getByTestId('toolbar-debug-button');
    expect((debugBtn as HTMLButtonElement).disabled).toBe(false);
    await user.click(debugBtn);

    expect(mockRun).toHaveBeenCalledWith({ debug: true });
  });

  it('keeps Debug disabled when all breakpoints are disabled', async () => {
    const user = userEvent.setup();
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 4);
    useDebuggerStore.getState().setAllBreakpointsEnabled(false);

    render(<Toolbar />);

    await user.click(screen.getByTestId('toolbar-run-menu-button'));
    const debugBtn = screen.getByTestId('toolbar-debug-button');
    expect((debugBtn as HTMLButtonElement).disabled).toBe(true);
    expect(debugBtn.getAttribute('title')).toContain('Set an enabled breakpoint');
    expect(screen.queryByTestId('toolbar-breakpoint-pill')).toBeNull();
  });

  it('hides persisted breakpoint affordances for planned debugger languages', () => {
    editorStoreState.tabs = [
      {
        id: 'tab-1',
        name: 'untitled.py',
        language: 'python',
        content: '',
        isDirty: false,
      },
    ];
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 4);

    render(<Toolbar />);

    expect(screen.queryByTestId('toolbar-breakpoint-pill')).toBeNull();
    expect(screen.queryByTestId('toolbar-debug-button')).toBeNull();
  });

  it('shows the shared tooltip for the Run action on hover', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.hover(screen.getByTestId('toolbar-run-button'));

    expect(screen.getByRole('tooltip').textContent).toContain('Run (Cmd+Enter)');
  });

  it('switches the primary action to Validate for non-runnable config files', () => {
    editorStoreState.tabs = [
      {
        id: 'tab-json',
        name: 'package.json',
        language: 'json',
        content: '{ "name": "lingua" }',
        isDirty: false,
      },
    ];
    editorStoreState.activeTabId = 'tab-json';

    render(<Toolbar />);

    expect(screen.getByRole('button', { name: /Validate/ })).toBeTruthy();
  });

  it('disables the primary action for view-only file types', () => {
    editorStoreState.tabs = [
      {
        id: 'tab-toml',
        name: 'Cargo.toml',
        language: 'toml',
        content: 'name = "lingua"',
        isDirty: false,
      },
    ];
    editorStoreState.activeTabId = 'tab-toml';

    render(<Toolbar />);

    expect(screen.getByRole('button', { name: /View only/ })).toHaveProperty('disabled', true);
  });

  it('clicking Run button calls the run handler', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const runBtn = screen.getByTestId('toolbar-run-button');
    await user.click(runBtn);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('clicking the primary new-file action creates a file in the active language', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByRole('button', { name: 'New JavaScript' }));

    expect(mockAddTab).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'javascript' })
    );
  });

  it('opening the language menu lets the user create a file in a specific language', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByRole('button', { name: 'New file language menu' }));
    // The Go menu item now carries a capability badge ("Desktop only"), so
    // the accessible name is "GoDesktop only" — match as a prefix.
    await user.click(screen.getByRole('menuitem', { name: /^Go/ }));

    expect(mockAddTab).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'go' })
    );
  });

  it('shows a capability badge on host-toolchain languages and omits it on bundled ones (RL-038 Slice C)', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'New file language menu' }));

    // Go + Rust require a host toolchain — both render the badge.
    expect(screen.getByTestId('toolbar-new-file-capability-go')).toBeTruthy();
    expect(screen.getByTestId('toolbar-new-file-capability-rust')).toBeTruthy();
    expect(
      screen.getByTestId('toolbar-new-file-capability-go').textContent
    ).toContain('Desktop only');

    // JS / TS / Python ship their runtime in-process — no badge.
    expect(screen.queryByTestId('toolbar-new-file-capability-javascript')).toBeNull();
    expect(screen.queryByTestId('toolbar-new-file-capability-typescript')).toBeNull();
    expect(screen.queryByTestId('toolbar-new-file-capability-python')).toBeNull();
  });

  it('disables the Run button and shows the desktop-only tooltip when Go is active on the web build (RL-038 Slice C)', async () => {
    editorStoreState.tabs = [
      {
        id: 'tab-go',
        name: 'main.go',
        language: 'go',
        content: 'package main\n',
        isDirty: false,
      },
    ];
    editorStoreState.activeTabId = 'tab-go';

    const originalLingua = (window as unknown as { lingua?: unknown }).lingua;
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'web' },
    });

    const user = userEvent.setup();
    try {
      render(<Toolbar />);

      const runBtn = screen.getByTestId('toolbar-run-button');
      expect((runBtn as HTMLButtonElement).disabled).toBe(true);

      await user.hover(runBtn);
      expect(screen.getByRole('tooltip').textContent).toContain(
        'Open this file in Lingua Desktop to run it with your local toolchain.'
      );
    } finally {
      Object.defineProperty(window, 'lingua', {
        configurable: true,
        writable: true,
        value: originalLingua,
      });
    }
  });

  it('keeps Run enabled when Go is active on the desktop build (RL-038 Slice C)', () => {
    editorStoreState.tabs = [
      {
        id: 'tab-go',
        name: 'main.go',
        language: 'go',
        content: 'package main\n',
        isDirty: false,
      },
    ];
    editorStoreState.activeTabId = 'tab-go';

    const originalLingua = (window as unknown as { lingua?: unknown }).lingua;
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'darwin' },
    });

    try {
      render(<Toolbar />);
      const runBtn = screen.getByTestId('toolbar-run-button');
      expect((runBtn as HTMLButtonElement).disabled).toBe(false);
    } finally {
      Object.defineProperty(window, 'lingua', {
        configurable: true,
        writable: true,
        value: originalLingua,
      });
    }
  });

  it('localizes the desktop-only tooltip when i18next is Spanish (RL-038 Slice C)', async () => {
    await i18next.changeLanguage('es');
    editorStoreState.tabs = [
      {
        id: 'tab-rs',
        name: 'main.rs',
        language: 'rust',
        content: 'fn main() {}\n',
        isDirty: false,
      },
    ];
    editorStoreState.activeTabId = 'tab-rs';

    const originalLingua = (window as unknown as { lingua?: unknown }).lingua;
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'web' },
    });

    const user = userEvent.setup();
    try {
      render(<Toolbar />);
      await user.hover(screen.getByTestId('toolbar-run-button'));
      expect(screen.getByRole('tooltip').textContent).toContain(
        'Abre este archivo en Lingua Desktop para ejecutarlo con tu cadena de herramientas local.'
      );
    } finally {
      Object.defineProperty(window, 'lingua', {
        configurable: true,
        writable: true,
        value: originalLingua,
      });
    }
  });

  it('keeps unsupported workflow segments hoverable for their help text', () => {
    editorStoreState.tabs = [
      {
        id: 'tab-python',
        name: 'main.py',
        language: 'python',
        content: '',
        isDirty: false,
        workflowMode: 'scratchpad',
      },
    ];
    editorStoreState.activeTabId = 'tab-python';

    render(<Toolbar />);

    const debugSegment = screen.getByTestId('workflow-mode-segment-debug');
    expect(debugSegment.getAttribute('aria-disabled')).toBe('true');
    expect(debugSegment).not.toHaveProperty('disabled', true);
    expect(debugSegment.getAttribute('title')).toContain(
      'Debug is only available for JavaScript and TypeScript today.'
    );
  });

  it('localizes the capability badge when i18next is Spanish', async () => {
    await i18next.changeLanguage('es');
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Menú de lenguaje para nuevo archivo' }));

    expect(
      screen.getByTestId('toolbar-new-file-capability-rust').textContent
    ).toContain('Solo escritorio');
  });

  it('marks paid languages as PRO and blocks creation on the Free tier', async () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByRole('button', { name: 'New file language menu' }));
    expect(screen.getByTestId('toolbar-new-file-capability-go').textContent).toContain('PRO');

    await user.click(screen.getByRole('menuitem', { name: /^Go/ }));

    expect(mockAddTab).not.toHaveBeenCalled();
    expect(uiStoreState.statusNotice).toMatchObject({
      messageKey: 'upsell.freeCeilingReached',
    });
  });

  it('blocks the primary new-file action when the active language is Pro-only on the Free tier', async () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    editorStoreState.tabs = [
      {
        id: 'tab-go',
        name: 'main.go',
        language: 'go',
        content: 'package main\n',
        isDirty: false,
      },
    ];
    editorStoreState.activeTabId = 'tab-go';
    const user = userEvent.setup();

    render(<Toolbar />);

    await user.click(screen.getByRole('button', { name: 'New Go' }));

    expect(mockAddTab).not.toHaveBeenCalled();
    expect(uiStoreState.statusNotice).toMatchObject({
      messageKey: 'upsell.freeCeilingReached',
    });
  });

  it('renders localized toolbar copy in Spanish', async () => {
    await i18next.changeLanguage('es');

    render(<Toolbar />);

    expect(screen.getByRole('button', { name: 'Abrir archivo (Cmd+O)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nuevo JavaScript' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Menú de lenguaje para nuevo archivo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Configuración (Cmd+,)' })).toBeTruthy();
  });

  it('opens developer utilities from the toolbar button', async () => {
    const user = userEvent.setup();
    const onOpenUtilities = vi.fn();

    render(<Toolbar onOpenUtilities={onOpenUtilities} />);

    await user.click(screen.getByRole('button', { name: 'Developer utilities' }));

    expect(onOpenUtilities).toHaveBeenCalledOnce();
  });

  it('shows the active Developer Utilities shortcut in the toolbar tooltip', async () => {
    const user = userEvent.setup();
    useSettingsStore
      .getState()
      .setShortcutOverride('overlay-developer-utilities', [{ tokens: ['Mod', 'Alt', 'K'] }]);

    render(<Toolbar />);

    await user.hover(screen.getByRole('button', { name: 'Developer utilities' }));

    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Developer utilities (Ctrl+Alt+K)'
    );
  });

  it('blocks developer utilities on the Free tier', async () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    const user = userEvent.setup();
    const onOpenUtilities = vi.fn();

    render(<Toolbar onOpenUtilities={onOpenUtilities} />);

    await user.click(screen.getByRole('button', { name: 'Developer utilities' }));

    expect(onOpenUtilities).not.toHaveBeenCalled();
    expect(uiStoreState.statusNotice).toMatchObject({
      messageKey: 'upsell.freeCeilingReached',
    });
  });

  it('marks developer utilities as the active affordance when the modal is open', () => {
    render(<Toolbar utilitiesOpen />);

    expect(screen.getByRole('button', { name: 'Developer utilities' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('exposes the console toggle as a pressed state when the console is visible', () => {
    render(<Toolbar />);

    expect(
      screen.getByRole('button', { name: 'Toggle console (Cmd+\\)' }).getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('shows the Pro-only tooltip for Go on the Free tier before the desktop-only gate', async () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    editorStoreState.tabs = [
      {
        id: 'tab-go',
        name: 'main.go',
        language: 'go',
        content: 'package main\n',
        isDirty: false,
      },
    ];
    editorStoreState.activeTabId = 'tab-go';

    const originalLingua = (window as unknown as { lingua?: unknown }).lingua;
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'web' },
    });

    const user = userEvent.setup();
    try {
      render(<Toolbar />);
      const runBtn = screen.getByTestId('toolbar-run-button');
      expect((runBtn as HTMLButtonElement).disabled).toBe(true);

      await user.hover(runBtn);
      expect(screen.getByRole('tooltip').textContent).toContain(
        'This runtime is available in Lingua Pro.'
      );
    } finally {
      Object.defineProperty(window, 'lingua', {
        configurable: true,
        writable: true,
        value: originalLingua,
      });
    }
  });
});
