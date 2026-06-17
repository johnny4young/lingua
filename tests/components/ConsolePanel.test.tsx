import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
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
const mockAddEntry = vi.fn();
const mockRun = vi.fn().mockResolvedValue(undefined);
const mockPushStatusNotice = vi.fn();
const { mockTrackEvent, mockTrackOutputOriginClicked } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn(),
  mockTrackOutputOriginClicked: vi.fn(),
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
  | 'collapsedEntries'
> = {
  entries: [],
  activeFilters: new Set<ConsoleEntryType>(['log', 'info', 'warn', 'error', 'result']),
  hiddenPayloadKinds: new Set(),
  showTimestamps: false,
};

// RL-123 — the store now collapses consecutive identical entries at push
// time and exposes `collapsedEntries`; the panel reads those. Mirror that
// collapse here so the mocked store hands the panel the same rows the real
// store would (same type + line + content + payload equality).
// Mirror the store's `payloadShape`: an empty or absent payload both hash to
// '' (so an empty array collapses with an undefined payload), which a naive
// `JSON.stringify` would not — keeps this mock faithful to consoleStore.
function mockPayloadShape(
  payload: ConsoleState['entries'][number]['payload']
): string {
  return payload && payload.length > 0 ? JSON.stringify(payload) : '';
}

function collapseForMock(
  entries: ConsoleState['entries']
): ConsoleState['collapsedEntries'] {
  const rows: ConsoleState['collapsedEntries'] = [];
  for (const entry of entries) {
    const last = rows[rows.length - 1];
    if (
      last &&
      last.entry.type === entry.type &&
      last.entry.line === entry.line &&
      last.entry.content === entry.content &&
      mockPayloadShape(last.entry.payload) === mockPayloadShape(entry.payload)
    ) {
      last.repeatCount += 1;
    } else {
      rows.push({ entry, repeatCount: 1 });
    }
  }
  return rows;
}

vi.mock('../../src/renderer/stores/consoleStore', () => ({
  useConsoleStore: () => ({
    ...mockState,
    collapsedEntries: collapseForMock(mockState.entries),
    clear: mockClear,
    toggleFilter: mockToggleFilter,
    togglePayloadKindFilter: vi.fn(),
    clearPayloadKindFilters: vi.fn(),
    toggleTimestamps: mockToggleTimestamps,
    addEntry: mockAddEntry,
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
  return {
    useEditorStore,
    getActiveTab: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
      s.tabs.find((t) => t.id === s.activeTabId) ?? null,
    getActiveTabIndex: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
      s.activeTabId == null ? -1 : s.tabs.findIndex((t) => t.id === s.activeTabId),
  };
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
  trackOutputOriginClicked: mockTrackOutputOriginClicked,
}));

// Also mock lucide-react icons used by ConsolePanel
vi.mock('lucide-react', () => ({
  Clock: () => null,
  Trash2: () => null,
  History: () => null,
  // RL-044 Slice 2b-β-α — `<ConsoleEntryRenderer>` now uses Maximize2
  // for the "Open details" chip in place of the old Unicode glyph.
  Maximize2: () => null,
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

  // RL-044 next slice — image clipboard paste into the console.
  describe('image clipboard paste', () => {
    function dispatchImagePaste(opts: {
      mime?: string;
      bytes?: number;
      asText?: boolean;
    }) {
      const event = new Event('paste', { bubbles: true });
      const file = opts.asText
        ? null
        : new File([new Uint8Array(opts.bytes ?? 16)], 'p.png', {
            type: opts.mime ?? 'image/png',
          });
      const items = opts.asText
        ? [{ kind: 'string', type: 'text/plain', getAsFile: () => null }]
        : [{ kind: 'file', type: opts.mime ?? 'image/png', getAsFile: () => file }];
      Object.defineProperty(event, 'clipboardData', {
        value: { items, files: file ? [file] : [] },
      });
      document.dispatchEvent(event);
    }

    it('appends an image rich entry + success toast + telemetry on a valid paste', async () => {
      render(<ConsolePanel />);
      await act(async () => {
        dispatchImagePaste({ bytes: 32 });
        await new Promise((r) => setTimeout(r, 0));
      });
      await vi.waitFor(() => expect(mockAddEntry).toHaveBeenCalledTimes(1));
      const entry = mockAddEntry.mock.calls[0]![0];
      expect(entry.payload?.[0]).toMatchObject({ kind: 'image' });
      expect(entry.payload?.[0].src.startsWith('data:image/')).toBe(true);
      expect(mockPushStatusNotice).toHaveBeenCalledWith(
        expect.objectContaining({ messageKey: 'console.imagePaste.pasted' })
      );
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'runtime.image_clipboard_pasted',
        expect.objectContaining({ status: 'pasted' })
      );
    });

    it('reads an image from clipboardData.files when items are empty', async () => {
      render(<ConsolePanel />);
      const event = new Event('paste', { bubbles: true });
      const file = new File([new Uint8Array(32)], 'from-files.png', {
        type: 'image/png',
      });
      Object.defineProperty(event, 'clipboardData', {
        value: { items: [], files: [file] },
      });
      await act(async () => {
        document.dispatchEvent(event);
        await new Promise((r) => setTimeout(r, 0));
      });
      await vi.waitFor(() => expect(mockAddEntry).toHaveBeenCalledTimes(1));
      expect(mockAddEntry.mock.calls[0]![0].payload?.[0]).toMatchObject({
        kind: 'image',
      });
    });

    it('ignores a text-only paste (no entry, no telemetry)', async () => {
      render(<ConsolePanel />);
      await act(async () => {
        dispatchImagePaste({ asText: true });
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(mockAddEntry).not.toHaveBeenCalled();
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        'runtime.image_clipboard_pasted',
        expect.anything()
      );
    });

    it('rejects an oversized image with a toast + rejected-oversized telemetry', async () => {
      render(<ConsolePanel />);
      await act(async () => {
        // 2 MiB + 1 byte trips the cap.
        dispatchImagePaste({ bytes: 2 * 1024 * 1024 + 1 });
        await new Promise((r) => setTimeout(r, 0));
      });
      await vi.waitFor(() =>
        expect(mockTrackEvent).toHaveBeenCalledWith(
          'runtime.image_clipboard_pasted',
          expect.objectContaining({ status: 'rejected-oversized' })
        )
      );
      expect(mockAddEntry).not.toHaveBeenCalled();
      expect(mockPushStatusNotice).toHaveBeenCalledWith(
        expect.objectContaining({ messageKey: 'console.imagePaste.tooLarge' })
      );
    });
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

  it('renders plain source-line entries with a clickable output badge', async () => {
    const user = userEvent.setup();
    const openSpy = vi.fn();
    window.addEventListener('lingua-open-file', openSpy);
    try {
      resetState({
        entries: [
          {
            id: 'plain-origin',
            type: 'log',
            content: 'plain stdout',
            timestamp: Date.now(),
            line: 12,
            language: 'go',
          },
        ],
      });

      render(<ConsolePanel />);

      const badge = screen.getByTestId('output-line-badge');
      expect(badge.textContent).toBe('L12');
      await user.click(badge);

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect((openSpy.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        file: '',
        line: 12,
        column: undefined,
      });
      expect(mockTrackOutputOriginClicked).toHaveBeenCalledWith('go', 'badge');
    } finally {
      window.removeEventListener('lingua-open-file', openSpy);
    }
  });

  it('hides fallback badges and row pulses when @origin off is present', () => {
    resetState({
      entries: [
        { id: 'line-3', type: 'log', content: 'hidden origin', timestamp: Date.now(), line: 3 },
      ],
    });
    mockTabs = [
      {
        id: 'active-tab',
        name: 'main.js',
        language: 'javascript',
        content: '// @origin off\nconsole.log("hidden origin")',
        isDirty: false,
      },
    ];
    mockActiveTabId = 'active-tab';

    render(<ConsolePanel />);
    const row = screen.getByTestId('console-entry-row');

    expect(screen.queryByTestId('output-line-badge')).toBeNull();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lingua-source-line-hovered', {
          detail: { line: 3, durationMs: 1000 },
        })
      );
    });
    expect(row.getAttribute('data-pulsing')).toBeNull();
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      'runtime.cursor_pulse_emitted',
      expect.anything()
    );
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

  // Slice 2 — `outputSourceMappingEnabled` was removed; the cursor
  // pulse listener is always installed. The "silence when OFF" and
  // "clear in-flight on flip" cases no longer apply.

  // RL-044 Sub-slice G.1 Fold D — adoption telemetry fires once per
  // successful pulse with the active tab's language.
  it('emits runtime.cursor_pulse_emitted telemetry on a successful pulse', () => {
    vi.useFakeTimers();
    try {
      mockTrackEvent.mockClear();
      // `resetState` clears mockTabs / mockActiveTabId, so seed the
      // active tab AFTER resetState — otherwise the listener reads an
      // empty store and attributes the event to `language: 'unknown'`.
      resetState({
        entries: [
          { id: 'line-3', type: 'log', content: 'three', timestamp: Date.now(), line: 3 },
        ],
      });
      mockTabs = [
        {
          id: 'tab-1',
          name: 'untitled.js',
          language: 'javascript',
          content: '',
          isDirty: false,
        } as FileTab,
      ];
      mockActiveTabId = 'tab-1';
      render(<ConsolePanel />);
      act(() => {
        window.dispatchEvent(
          new CustomEvent('lingua-source-line-hovered', {
            detail: { line: 3, durationMs: 1000 },
          })
        );
      });
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'runtime.cursor_pulse_emitted',
        { language: 'javascript' }
      );
    } finally {
      mockTabs = [];
      mockActiveTabId = null;
      vi.useRealTimers();
    }
  });

  it('does not emit cursor pulse telemetry when no visible row matches the cursor line', () => {
    mockTrackEvent.mockClear();
    resetState({
      entries: [
        { id: 'line-3', type: 'log', content: 'three', timestamp: Date.now(), line: 3 },
      ],
    });

    render(<ConsolePanel />);
    const row = screen.getByTestId('console-entry-row');
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lingua-source-line-hovered', {
          detail: { line: 99, durationMs: 1000 },
        })
      );
    });

    expect(row.getAttribute('data-pulsing')).toBeNull();
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      'runtime.cursor_pulse_emitted',
      expect.anything()
    );
  });

  it('keeps the latest source-line pulse active when cursor events overlap', () => {
    vi.useFakeTimers();
    try {
      resetState({
        entries: [
          { id: 'line-3', type: 'log', content: 'three', timestamp: Date.now(), line: 3 },
          { id: 'line-4', type: 'log', content: 'four', timestamp: Date.now(), line: 4 },
        ],
      });

      render(<ConsolePanel />);
      const rows = screen.getAllByTestId('console-entry-row');
      const pulse = (line: number) => {
        act(() => {
          window.dispatchEvent(
            new CustomEvent('lingua-source-line-hovered', {
              detail: { line, durationMs: 1000 },
            })
          );
        });
      };

      pulse(3);
      expect(rows[0]?.getAttribute('data-pulsing')).toBe('true');
      expect(rows[1]?.getAttribute('data-pulsing')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(500);
      });
      pulse(4);
      expect(rows[0]?.getAttribute('data-pulsing')).toBeNull();
      expect(rows[1]?.getAttribute('data-pulsing')).toBe('true');

      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(rows[1]?.getAttribute('data-pulsing')).toBe('true');

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(rows[1]?.getAttribute('data-pulsing')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it('uses the entry language when clickable error stack frames emit telemetry', async () => {
    const user = userEvent.setup();
    resetState({
      entries: [
        {
          id: 'error-stack',
          type: 'log',
          content: 'ValueError: bad input',
          timestamp: Date.now(),
          language: 'python',
          payload: [
            {
              kind: 'error',
              message: 'bad input',
              stack: [
                {
                  text: 'File "example.py", line 7, in <module>',
                  file: 'example.py',
                  line: 7,
                },
              ],
            },
          ],
        },
      ],
    });

    render(<ConsolePanel />);

    await user.click(screen.getByTestId('console-rich-error-frame-clickable'));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'runtime.error_stack_frame_clicked',
      { language: 'python' }
    );
  });

  it('renders Slice 2a html, image, and error previews inside the details popover', async () => {
    const user = userEvent.setup();
    resetState({
      entries: [
        {
          id: 'html-rich',
          type: 'log',
          content: '<strong>Hello</strong>',
          timestamp: Date.now(),
          language: 'javascript',
          payload: [{ kind: 'html', html: '<strong>Hello</strong>', height: 80 }],
        },
        {
          id: 'image-rich',
          type: 'log',
          content: '[image]',
          timestamp: Date.now(),
          language: 'javascript',
          payload: [
            {
              kind: 'image',
              src: 'data:image/png;base64,iVBORw0KGgo=',
              mime: 'image/png',
            },
          ],
        },
        {
          id: 'error-rich',
          type: 'log',
          content: 'Error: boom',
          timestamp: Date.now(),
          language: 'javascript',
          payload: [
            {
              kind: 'error',
              message: 'boom',
              stack: [{ text: 'at main (index.js:1:1)', file: 'index.js', line: 1 }],
            },
          ],
        },
      ],
    });

    render(<ConsolePanel />);

    const detailButtons = screen.getAllByTestId('console-rich-open-details');
    await user.click(detailButtons[0]!);
    expect(
      within(screen.getByRole('dialog')).getByTestId('console-rich-html-iframe')
    ).toBeTruthy();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

    await user.click(detailButtons[1]!);
    expect(
      within(screen.getByRole('dialog')).getByTestId('console-rich-image')
    ).toBeTruthy();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

    await user.click(detailButtons[2]!);
    expect(within(screen.getByRole('dialog')).getByText('Stack trace')).toBeTruthy();
  });

  it('portals the rich-output details popover to <body> so a filtered console ancestor cannot clip the table', async () => {
    const user = userEvent.setup();
    resetState({
      entries: [
        {
          id: 'table-rich',
          type: 'log',
          content: 'Table(3×2)',
          timestamp: Date.now(),
          language: 'javascript',
          payload: [
            {
              kind: 'table',
              columns: ['name', 'kcal'],
              rows: [
                [
                  { kind: 'primitive', type: 'string', repr: '"apple"' },
                  { kind: 'primitive', type: 'number', repr: '52' },
                ],
                [
                  { kind: 'primitive', type: 'string', repr: '"mango"' },
                  { kind: 'primitive', type: 'number', repr: '60' },
                ],
                [
                  { kind: 'primitive', type: 'string', repr: '"banana"' },
                  { kind: 'primitive', type: 'number', repr: '89' },
                ],
              ],
            },
          ],
        },
      ],
    });

    const { container } = render(<ConsolePanel />);
    await user.click(screen.getByTestId('console-rich-open-details'));

    const dialog = screen.getByRole('dialog');
    // The popover renders via createPortal to <body>, NOT inside the
    // ConsolePanel subtree. The console panel carries `backdrop-filter:
    // blur()`, which (like `transform` / `filter`) makes it the containing
    // block for `position: fixed` descendants — so an in-tree overlay's
    // `fixed inset-0` is trapped inside the short console strip and clips the
    // table below the viewport. Portaling escapes that ancestor. (jsdom does
    // not compute layout, so this pins the portal mechanism, not the pixels.)
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    // The full typed table renders in the portaled dialog (all rows present).
    expect(within(dialog).getByText('"banana"')).toBeTruthy();
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
