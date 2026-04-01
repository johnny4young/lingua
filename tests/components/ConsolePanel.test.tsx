import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConsoleState, ConsoleEntryType } from '../../src/renderer/types/index';

// ---------------------------------------------------------------------------
// Mock the console store
// ---------------------------------------------------------------------------

const mockClear = vi.fn();
const mockToggleFilter = vi.fn();
const mockToggleTimestamps = vi.fn();

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

// Also mock lucide-react icons used by ConsolePanel
vi.mock('lucide-react', () => ({
  Clock: () => null,
  Trash2: () => null,
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConsolePanel', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
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
    const logButton = screen.getByTitle('Toggle log output');
    await user.click(logButton);
    expect(mockToggleFilter).toHaveBeenCalledWith('log');
  });

  it('clicking clear button calls the clear action', async () => {
    const user = userEvent.setup();
    render(<ConsolePanel />);
    const clearButton = screen.getByTitle('Clear console');
    await user.click(clearButton);
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
});
