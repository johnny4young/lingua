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

const mockAddTab = vi.fn();

vi.mock('../../src/renderer/stores/editorStore', () => {
  const tab = {
    id: 'tab-1',
    name: 'untitled.js',
    language: 'javascript',
    content: '',
    isDirty: false,
  };
  return {
    useEditorStore: () => ({
      tabs: [tab],
      activeTabId: 'tab-1',
      addTab: mockAddTab,
    }),
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

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Play: () => <span data-testid="icon-play">▶</span>,
  Square: () => <span data-testid="icon-stop">■</span>,
  Plus: () => null,
  Settings: () => null,
  Loader2: () => <span data-testid="icon-loader">…</span>,
  Terminal: () => null,
  Search: () => null,
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
    render(<Toolbar />);
    const stopBtn = screen.getByTitle('Stop');
    expect(stopBtn).toBeTruthy();
  });

  it('disables the Stop button when not running', () => {
    render(<Toolbar />);
    const stopBtn = screen.getByTitle('Stop');
    expect((stopBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables the Stop button when running', () => {
    resetRunnerState({ isRunning: true });
    render(<Toolbar />);
    const stopBtn = screen.getByTitle('Stop');
    expect((stopBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('language selector is present and shows current language', () => {
    render(<Toolbar />);
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe('javascript');
  });

  it('clicking Run button calls the run handler', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const runBtn = screen.getByTitle('Run (Cmd+Enter)');
    await user.click(runBtn);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});
