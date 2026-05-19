import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConsoleState, ConsoleEntryType, FileTab } from '../../src/renderer/types/index';
import { useExecutionHistoryStore } from '../../src/renderer/stores/executionHistoryStore';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';

// ---------------------------------------------------------------------------
// Mock the console store
// ---------------------------------------------------------------------------

const mockClear = vi.fn();
const mockToggleFilter = vi.fn();
const mockToggleTimestamps = vi.fn();
const mockRun = vi.fn().mockResolvedValue(undefined);
const mockPushStatusNotice = vi.fn();
const { mockTrackEvent } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn(),
}));

let mockTabs: FileTab[] = [];
let mockActiveTabId: string | null = null;

const mockSetActiveTab = vi.fn((id: string) => {
  mockActiveTabId = id;
});
const mockAddTab = vi.fn((tab: FileTab) => {
  mockTabs = [...mockTabs, { ...tab, isDirty: false }];
  mockActiveTabId = tab.id;
});

let mockState: Omit<
  ConsoleState,
  | 'addEntry'
  | 'clear'
  | 'toggleFilter'
  | 'toggleTimestamps'
  | 'togglePayloadKindFilter'
  | 'clearPayloadKindFilters'
> = {
  entries: [],
  activeFilters: new Set<ConsoleEntryType>(['log', 'info', 'warn', 'error', 'result']),
  hiddenPayloadKinds: new Set(),
  showTimestamps: false,
};

vi.mock('../../src/renderer/stores/consoleStore', () => ({
  useConsoleStore: () => ({
    ...mockState,
    clear: mockClear,
    toggleFilter: mockToggleFilter,
    togglePayloadKindFilter: vi.fn(),
    clearPayloadKindFilters: vi.fn(),
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

vi.mock('../../src/renderer/stores/editorStore', () => {
  function editorStoreState() {
    return {
      tabs: mockTabs,
      activeTabId: mockActiveTabId,
      addTab: mockAddTab,
      setActiveTab: mockSetActiveTab,
    };
  }
  // RL-020 Slice 4 — ExecutionHistoryPopover reads
  // `useEditorStore((state) => state.activeTabId)` to surface the
  // fold-C "This tab only" filter. The mock therefore needs to be
  // callable as both a selector hook AND a `getState()` accessor so
  // pre-existing call sites keep working.
  const useEditorStore = ((
    selector?: (state: ReturnType<typeof editorStoreState>) => unknown
  ) => {
    const state = editorStoreState();
    return selector ? selector(state) : state;
  }) as ((selector?: unknown) => unknown) & {
    getState: () => ReturnType<typeof editorStoreState>;
  };
  useEditorStore.getState = editorStoreState;
  return { useEditorStore };
});

vi.mock('../../src/renderer/stores/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      pushStatusNotice: mockPushStatusNotice,
    }),
  },
}));

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
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
    // RL-044 Slice 1B fold A — payload-kind filter; empty Set means
    // every kind is visible. Without this default the ConsolePanel
    // throws in the new chip-row + filter loops.
    hiddenPayloadKinds: new Set(),
    showTimestamps: false,
    ...partial,
  };
  mockTabs = [];
  mockActiveTabId = null;
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

  it('filters a mixed rich entry when any contained payload kind is hidden', () => {
    resetState({
      entries: [
        {
          id: 'mixed-rich',
          type: 'log',
          content: 'Table(1×1) label',
          timestamp: Date.now(),
          payload: [
            {
              kind: 'table',
              columns: ['name'],
              rows: [[{ kind: 'primitive', type: 'string', repr: '"alice"' }]],
            },
            { kind: 'primitive', type: 'string', repr: '"label"' },
          ],
        },
      ],
      hiddenPayloadKinds: new Set(['table']),
    });

    render(<ConsolePanel />);

    expect(screen.getByText('No entries match the active filters.')).toBeTruthy();
    expect(screen.queryByText('Table(1×1) label')).toBeNull();
  });

  it('filters Python error payloads with the Errors chip', () => {
    resetState({
      entries: [
        {
          id: 'python-error-payload',
          type: 'log',
          content: 'ValueError: bad input',
          timestamp: Date.now(),
          payload: [
            {
              kind: 'error',
              message: 'bad input',
            },
          ],
        },
      ],
      hiddenPayloadKinds: new Set(['errorish']),
    });

    render(<ConsolePanel />);

    expect(screen.getByText('No entries match the active filters.')).toBeTruthy();
    expect(screen.queryByText('ValueError: bad input')).toBeNull();
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

  it('replays a history snapshot in a new tab without appending history', async () => {
    const user = userEvent.setup();
    mockTabs = [
      {
        id: 'js-tab',
        name: 'main.js',
        language: 'javascript',
        content: 'console.log("current")',
        isDirty: false,
      },
    ];
    mockActiveTabId = 'js-tab';
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 120,
      snapshot: {
        code: 'console.log("historical")',
        language: 'javascript',
      },
    });

    render(<ConsolePanel />);

    await user.click(screen.getByTestId('execution-history-toggle'));
    await user.click(screen.getByTestId('execution-history-rerun'));

    expect(useExecutionHistoryStore.getState().entries).toHaveLength(1);
    expect(mockAddTab).toHaveBeenCalledTimes(1);
    expect(mockAddTab.mock.calls[0]?.[0]).toMatchObject({
      name: expect.stringMatching(/^replay-.+\.js$/),
      language: 'javascript',
      content: 'console.log("historical")',
      isDirty: false,
    });
    expect(mockActiveTabId).toBe(mockAddTab.mock.calls[0]?.[0].id);
    expect(mockRun).toHaveBeenCalledWith({ recordHistory: false });
    expect(mockSetActiveTab).not.toHaveBeenCalled();
    expect(mockTrackEvent).toHaveBeenCalledWith('runtime.history_replay', {
      language: 'javascript',
      status: 'ok',
      surface: 'popover',
    });
  });

  it('keeps metadata-only history entries disabled because there is no snapshot to replay', async () => {
    const user = userEvent.setup();
    useExecutionHistoryStore.getState().record({
      language: 'python',
      status: 'ok',
      durationMs: 120,
    });

    render(<ConsolePanel />);

    await user.click(screen.getByTestId('execution-history-toggle'));

    expect((screen.getByTestId('execution-history-rerun') as HTMLButtonElement).disabled).toBe(
      true
    );

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockAddTab).not.toHaveBeenCalled();
    expect(mockSetActiveTab).not.toHaveBeenCalled();
    expect(mockPushStatusNotice).not.toHaveBeenCalled();
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
