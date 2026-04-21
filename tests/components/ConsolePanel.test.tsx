import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConsoleState, ConsoleEntryType } from '../../src/renderer/types/index';
import { useExecutionHistoryStore } from '../../src/renderer/stores/executionHistoryStore';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';

// ---------------------------------------------------------------------------
// Mock the console store
// ---------------------------------------------------------------------------

const mockClear = vi.fn();
const mockToggleFilter = vi.fn();
const mockToggleTimestamps = vi.fn();
const mockRun = vi.fn().mockResolvedValue(undefined);
const mockSetActiveTab = vi.fn();
const mockPushStatusNotice = vi.fn();

let mockTabs: Array<{ id: string; language: string }> = [];

let mockState: Omit<ConsoleState, 'addEntry' | 'clear' | 'toggleFilter' | 'toggleTimestamps'> = {
  entries: [],
  activeFilters: new Set<ConsoleEntryType>(['log', 'info', 'warn', 'error', 'result']),
  showTimestamps: false,
};

vi.mock('../../src/renderer/stores/consoleStore', () => ({
  useConsoleStore: () => ({
    ...mockState,
    clear: mockClear,
    toggleFilter: mockToggleFilter,
    toggleTimestamps: mockToggleTimestamps,
    addEntry: vi.fn(),
  }),
}));

vi.mock('../../src/renderer/hooks/useRunner', () => ({
  useRunner: () => ({
    run: mockRun,
    stop: vi.fn(),
    isRunning: false,
    isInitializing: false,
    loadingMessage: null,
  }),
}));

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      tabs: mockTabs,
      setActiveTab: mockSetActiveTab,
    }),
  },
}));

vi.mock('../../src/renderer/stores/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      pushStatusNotice: mockPushStatusNotice,
    }),
  },
}));

// Also mock lucide-react icons used by ConsolePanel
vi.mock('lucide-react', () => ({
  Clock: () => null,
  Trash2: () => null,
  History: () => null,
}));

import { ConsolePanel } from '../../src/renderer/components/Console/ConsolePanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(partial: Partial<typeof mockState> = {}) {
  mockState = {
    entries: [],
    activeFilters: new Set<ConsoleEntryType>(['log', 'info', 'warn', 'error', 'result']),
    showTimestamps: false,
    ...partial,
  };
  mockTabs = [];
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

describe('ConsolePanel', () => {
  beforeEach(() => {
    resetState();
    setActiveProLicense();
    useExecutionHistoryStore.getState().clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    useExecutionHistoryStore.getState().clear();
  });

  it('renders the empty-state message when entries array is empty', () => {
    render(<ConsolePanel />);
    expect(screen.getByText('Output will appear here...')).toBeTruthy();
  });

  it('renders a log entry when entries contains a log item', () => {
    resetState({
      entries: [
        { id: '1', type: 'log', content: 'hello world', timestamp: Date.now() },
      ],
    });
    render(<ConsolePanel />);
    expect(screen.getByText('hello world')).toBeTruthy();
    // "LOG" appears twice: once in the filter bar button, once in the entry row badge
    const logLabels = screen.getAllByText('LOG');
    expect(logLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('renders an error entry with ERR badge', () => {
    resetState({
      entries: [
        { id: '2', type: 'error', content: 'something blew up', timestamp: Date.now() },
      ],
    });
    render(<ConsolePanel />);
    expect(screen.getByText('something blew up')).toBeTruthy();
    // "ERR" appears in both the filter bar button and the entry row badge
    const errLabels = screen.getAllByText('ERR');
    expect(errLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('shows "No entries match the active filters" when entries exist but all filtered out', () => {
    resetState({
      entries: [
        { id: '3', type: 'warn', content: 'a warning', timestamp: Date.now() },
      ],
      // activeFilters does NOT include 'warn'
      activeFilters: new Set<ConsoleEntryType>(['log', 'info', 'error', 'result']),
    });
    render(<ConsolePanel />);
    expect(screen.getByText('No entries match the active filters.')).toBeTruthy();
  });

  it('clicking a filter pill calls toggleFilter with its type', async () => {
    const user = userEvent.setup();
    render(<ConsolePanel />);
    const logButton = screen.getByRole('button', { name: 'LOG' });
    await user.hover(logButton);
    expect(screen.getByRole('tooltip').textContent).toContain('Toggle log output');
    await user.click(logButton);
    expect(mockToggleFilter).toHaveBeenCalledWith('log');
  });

  it('clicking clear button calls the clear action', async () => {
    const user = userEvent.setup();
    render(<ConsolePanel />);
    const clearButton = screen.getByRole('button', { name: 'Clear console' });
    await user.click(clearButton);
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('reruns a history entry by focusing the first open tab in that language', async () => {
    const user = userEvent.setup();
    mockTabs = [{ id: 'python-tab', language: 'python' }];
    useExecutionHistoryStore.getState().record({
      language: 'python',
      status: 'ok',
      durationMs: 120,
    });

    render(<ConsolePanel />);

    await user.click(screen.getByTestId('execution-history-toggle'));
    await user.click(screen.getByTestId('execution-history-rerun'));

    expect(mockSetActiveTab).toHaveBeenCalledWith('python-tab');
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('shows an info notice instead of rerunning when no matching language tab is open', async () => {
    const user = userEvent.setup();
    mockTabs = [{ id: 'js-tab', language: 'javascript' }];
    useExecutionHistoryStore.getState().record({
      language: 'python',
      status: 'ok',
      durationMs: 120,
    });

    render(<ConsolePanel />);

    await user.click(screen.getByTestId('execution-history-toggle'));
    await user.click(screen.getByTestId('execution-history-rerun'));

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockSetActiveTab).not.toHaveBeenCalled();
    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'info',
        messageKey: 'executionHistory.rerun.noOpenTab',
      })
    );
  });

  it('blocks the history popover on the Free tier', async () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    const user = userEvent.setup();
    render(<ConsolePanel />);

    await user.click(screen.getByTestId('execution-history-toggle'));

    expect(screen.queryByTestId('execution-history-popover')).toBeNull();
    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'info',
        messageKey: 'upsell.freeCeilingReached',
      })
    );
  });
});
