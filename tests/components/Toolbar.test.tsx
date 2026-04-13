import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before component imports
// ---------------------------------------------------------------------------

const mockRun = vi.fn();
const mockStop = vi.fn();

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
  const tab = {
    id: 'tab-1',
    name: 'untitled.js',
    language: 'javascript',
    content: '',
    isDirty: false,
  };
  const storeState = {
    tabs: [tab],
    activeTabId: 'tab-1',
    addTab: mockAddTab,
    openFileFromDisk: mockOpenFileFromDisk,
  };
  const useEditorStore = () => storeState;
  useEditorStore.getState = () => storeState;
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
  beforeEach(() => {
    resetRunnerState();
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<Toolbar />);
    expect(screen.getByTitle('Run (Cmd+Enter)')).toBeTruthy();
  });

  it('shows the Run button with "Run" label when not running', () => {
    render(<Toolbar />);
    const runBtn = screen.getByTitle('Run (Cmd+Enter)');
    expect(runBtn).toBeTruthy();
    expect(runBtn.textContent).toContain('Run');
  });

  it('shows "Running..." label and disables Run button when running', () => {
    resetRunnerState({ isRunning: true });
    render(<Toolbar />);
    const runBtn = screen.getByTitle('Run (Cmd+Enter)');
    expect(runBtn.textContent).toContain('Running...');
    expect(runBtn).toHaveProperty('disabled', true);
  });

  it('shows the Stop button at all times', () => {
    resetRunnerState({ isRunning: true });
    render(<Toolbar />);
    expect(screen.getByTitle('Stop')).toBeTruthy();
  });

  it('does not render the Stop button when not running', () => {
    render(<Toolbar />);
    expect(screen.queryByTitle('Stop')).toBeNull();
  });

  it('enables the Stop button when running', () => {
    resetRunnerState({ isRunning: true });
    render(<Toolbar />);
    const stopBtn = screen.getByTitle('Stop');
    expect((stopBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders an explicit new-file action for the active language', () => {
    render(<Toolbar />);
    expect(screen.getByTitle('New JavaScript file')).toBeTruthy();
    expect(screen.getByTitle('Choose language for new file')).toBeTruthy();
  });

  it('clicking Run button calls the run handler', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const runBtn = screen.getByTitle('Run (Cmd+Enter)');
    await user.click(runBtn);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('clicking the primary new-file action creates a file in the active language', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByTitle('New JavaScript file'));

    expect(mockAddTab).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'javascript' })
    );
  });

  it('opening the language menu lets the user create a file in a specific language', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByTitle('Choose language for new file'));
    await user.click(screen.getByRole('menuitem', { name: 'Go' }));

    expect(mockAddTab).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'go' })
    );
  });
});
