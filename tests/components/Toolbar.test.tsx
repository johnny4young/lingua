import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';

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
};

vi.mock('../../src/renderer/hooks/useRunner', () => ({
  useRunner: () => mockRunnerState,
}));

const { mockAddTab, mockToggleSidebar, mockToggleConsole, mockOpenFileFromDisk } = vi.hoisted(() => ({
  mockAddTab: vi.fn(),
  mockToggleSidebar: vi.fn(),
  mockToggleConsole: vi.fn(),
  mockOpenFileFromDisk: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/renderer/stores/editorStore', () => {
  const buildState = () => ({
    tabs: editorStoreState.tabs,
    activeTabId: editorStoreState.activeTabId,
    addTab: mockAddTab,
    openFileFromDisk: mockOpenFileFromDisk,
  });
  const useEditorStore = () => buildState();
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
  useUIStore: () => ({
    sidebarVisible: true,
    consoleVisible: true,
    toggleSidebar: mockToggleSidebar,
    toggleConsole: mockToggleConsole,
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
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Toolbar', () => {
  beforeEach(async () => {
    resetRunnerState();
    vi.clearAllMocks();
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
    expect(screen.getByRole('button', { name: /Run/ })).toBeTruthy();
  });

  it('shows the Run button with "Run" label when not running', () => {
    render(<Toolbar />);
    const runBtn = screen.getByRole('button', { name: /Run/ });
    expect(runBtn).toBeTruthy();
    expect(runBtn.textContent).toContain('Run');
  });

  it('shows "Running..." label and disables Run button when running', () => {
    resetRunnerState({ isRunning: true });
    render(<Toolbar />);
    const runBtn = screen.getByRole('button', { name: /Running/ });
    expect(runBtn.textContent).toContain('Running...');
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

  it('shows the shared tooltip for the Run action on hover', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.hover(screen.getByRole('button', { name: /Run/ }));

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
    const runBtn = screen.getByRole('button', { name: /Run/ });
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
    await user.click(screen.getByRole('menuitem', { name: 'Go' }));

    expect(mockAddTab).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'go' })
    );
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
});
