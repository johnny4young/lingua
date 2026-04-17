import { StrictMode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRestoreSession,
  mockSaveSession,
  mockEditorSubscribe,
  mockInitializePlugins,
  mockInitializeUpdates,
  mockConfirmClose,
  mockWrite,
  mockSaveDialog,
  mockForceClose,
  mockGetAppInfo,
  mockSetLastSeenVersion,
  mockSetHasCompletedTour,
  mockStartTour,
  mockUseDesktopSmoke,
} = vi.hoisted(() => ({
  mockRestoreSession: vi.fn().mockResolvedValue(undefined),
  mockSaveSession: vi.fn(),
  mockEditorSubscribe: vi.fn(() => () => {}),
  mockInitializePlugins: vi.fn().mockResolvedValue(undefined),
  mockInitializeUpdates: vi.fn().mockResolvedValue(undefined),
  mockConfirmClose: vi.fn().mockResolvedValue(0),
  mockWrite: vi.fn().mockResolvedValue(true),
  mockSaveDialog: vi.fn().mockResolvedValue('/saved/untitled.js'),
  mockForceClose: vi.fn(),
  mockGetAppInfo: vi.fn().mockResolvedValue({
    productName: 'Lingua',
    version: '0.1.0',
    buildDate: '2026-04-16T00:00:00.000Z',
    licenseType: 'MIT',
    repositoryUrl: 'https://github.com/johnny4young/lingua',
    websiteUrl: null,
    licenseUrl: 'https://github.com/johnny4young/lingua/blob/main/LICENSE',
  }),
  mockSetLastSeenVersion: vi.fn(),
  mockSetHasCompletedTour: vi.fn(),
  mockStartTour: vi.fn(),
  mockUseDesktopSmoke: vi.fn(),
}));

let beforeCloseHandler: (() => void) | undefined;

const mockEditorState = {
  saveActiveTab: vi.fn().mockResolvedValue(undefined),
  saveActiveTabAs: vi.fn().mockResolvedValue(undefined),
  saveTabById: vi.fn().mockResolvedValue(true),
  openFileFromDisk: vi.fn().mockResolvedValue(undefined),
  closeTab: vi.fn().mockResolvedValue(true),
  activeTabId: 'tab-1',
  tabs: [] as Array<{
    id: string;
    name: string;
    content: string;
    language: string;
    isDirty: boolean;
    filePath?: string;
  }>,
};

const mockSettingsState = {
  restoreSession: true,
  lastSeenVersion: null as string | null,
  hasCompletedTour: false,
  suppressTourAutoStart: false,
  setLastSeenVersion: mockSetLastSeenVersion,
  setHasCompletedTour: mockSetHasCompletedTour,
};

let smokeEnabled = false;

vi.mock('../../src/renderer/components/Layout', () => ({
  AppLayout: () => <div data-testid="app-layout">layout</div>,
}));

vi.mock('../../src/renderer/components/Settings/SettingsModal', () => ({
  SettingsModal: () => <div>settings</div>,
}));

vi.mock('../../src/renderer/components/Settings/WhatsNewSection', () => ({
  WhatsNewSection: () => <div>whats-new</div>,
}));

vi.mock('../../src/renderer/components/CommandPalette/CommandPalette', () => ({
  CommandPalette: () => <div>palette</div>,
}));

vi.mock('../../src/renderer/components/QuickOpen/QuickOpen', () => ({
  QuickOpen: () => <div>quick-open</div>,
}));

vi.mock('../../src/renderer/components/Snippets', () => ({
  SnippetsModal: () => <div>snippets</div>,
}));

vi.mock('../../src/renderer/components/GuidedTour/GuidedTourProvider', () => ({
  GuidedTourProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../src/renderer/components/GuidedTour/guidedTourContext', () => ({
  useGuidedTour: () => ({
    hasCompletedTour: mockSettingsState.hasCompletedTour,
    isTourActive: false,
    startTour: mockStartTour,
  }),
}));

vi.mock('../../src/renderer/hooks/useRunner', () => ({
  useRunner: () => ({
    run: vi.fn(),
    stop: vi.fn(),
    isRunning: false,
  }),
}));

vi.mock('../../src/renderer/hooks/useGlobalShortcuts', () => ({
  useGlobalShortcuts: () => undefined,
}));

vi.mock('../../src/renderer/hooks/useAutoRun', () => ({
  useAutoRun: () => undefined,
}));

vi.mock('../../src/renderer/hooks/useProjectWatchSync', () => ({
  useProjectWatchSync: () => undefined,
}));

vi.mock('../../src/renderer/hooks/useAppTheme', () => ({
  useAppTheme: () => undefined,
}));

vi.mock('../../src/renderer/hooks/useDesktopSmoke', () => ({
  useDesktopSmoke: mockUseDesktopSmoke,
}));

vi.mock('../../src/renderer/utils/desktopSmoke', () => ({
  desktopSmokeEnabled: () => smokeEnabled,
}));

vi.mock('../../src/renderer/stores/editorStore', () => {
  const useEditorStore = (selector?: (state: typeof mockEditorState) => unknown) =>
    selector ? selector(mockEditorState) : mockEditorState;
  useEditorStore.getState = () => mockEditorState;
  useEditorStore.subscribe = mockEditorSubscribe;
  return { useEditorStore };
});

vi.mock('../../src/renderer/stores/pluginStore', () => ({
  usePluginStore: (selector?: (state: { initialize: typeof mockInitializePlugins }) => unknown) => {
    const state = { initialize: mockInitializePlugins };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/renderer/stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      restoreSession: mockRestoreSession,
      saveSession: mockSaveSession,
    }),
  },
}));

vi.mock('../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector?: (state: typeof mockSettingsState) => unknown) =>
      selector ? selector(mockSettingsState) : mockSettingsState,
    {
      getState: () => mockSettingsState,
    }
  ),
}));

vi.mock('../../src/renderer/stores/uiStore', () => ({
  useUIStore: (selector?: (state: {
    toggleSidebar: ReturnType<typeof vi.fn>;
    toggleConsole: ReturnType<typeof vi.fn>;
    statusNotice: null;
    dismissStatusNotice: ReturnType<typeof vi.fn>;
  }) => unknown) => {
    const state = {
      toggleSidebar: vi.fn(),
      toggleConsole: vi.fn(),
      statusNotice: null,
      dismissStatusNotice: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/renderer/stores/updateStore', () => ({
  useUpdateStore: (selector?: (state: { initialize: typeof mockInitializeUpdates }) => unknown) => {
    const state = { initialize: mockInitializeUpdates };
    return selector ? selector(state) : state;
  },
}));

import { App } from '../../src/renderer/App';

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beforeCloseHandler = undefined;
    smokeEnabled = false;
    mockSettingsState.restoreSession = true;
    mockSettingsState.lastSeenVersion = null;
    mockSettingsState.hasCompletedTour = false;
    mockSettingsState.suppressTourAutoStart = false;
    mockEditorState.activeTabId = 'tab-1';
    mockEditorState.tabs = [];
    mockEditorState.saveTabById.mockResolvedValue(true);

    Object.defineProperty(window, 'lingua', {
      value: {
        onBeforeClose: (callback: () => void) => {
          beforeCloseHandler = callback;
          return () => {
            if (beforeCloseHandler === callback) {
              beforeCloseHandler = undefined;
            }
          };
        },
        confirmClose: mockConfirmClose,
        getAppInfo: mockGetAppInfo,
        forceClose: mockForceClose,
        fs: {
          write: mockWrite,
          saveDialog: mockSaveDialog,
        },
      },
      configurable: true,
      writable: true,
    });
  });

  it('restores the previous session only once under StrictMode', async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    await waitFor(() => {
      expect(mockRestoreSession).toHaveBeenCalledTimes(1);
    });
  });

  it('skips session restore and whats-new auto-open during desktop smoke mode', async () => {
    smokeEnabled = true;

    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    await waitFor(() => {
      expect(mockUseDesktopSmoke).toHaveBeenCalledWith(true);
      expect(mockRestoreSession).not.toHaveBeenCalled();
      expect(mockSetLastSeenVersion).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('whats-new');
    });
  });

  it('shows whats new only once for a newly seen version under StrictMode', async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    await waitFor(() => {
      expect(mockGetAppInfo).toHaveBeenCalled();
      expect(mockSetLastSeenVersion).toHaveBeenCalledWith('0.1.0');
      expect(mockSetLastSeenVersion).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain('whats-new');
    });
  });

  it('auto-starts the guided tour once after release-note gating is settled', async () => {
    mockSettingsState.lastSeenVersion = '0.1.0';

    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    await waitFor(() => {
      expect(mockStartTour).toHaveBeenCalledTimes(1);
    });
  });

  it('does not auto-start later in the same session after startup suppression was enabled', async () => {
    vi.useFakeTimers();
    try {
      mockSettingsState.lastSeenVersion = '0.1.0';
      mockSettingsState.suppressTourAutoStart = true;

      const { rerender } = render(
        <StrictMode>
          <App />
        </StrictMode>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(mockStartTour).not.toHaveBeenCalled();

      mockSettingsState.suppressTourAutoStart = false;
      rerender(
        <StrictMode>
          <App />
        </StrictMode>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(mockStartTour).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves untitled dirty tabs before forcing close', async () => {
    mockEditorState.tabs = [
      {
        id: 'tab-1',
        name: 'untitled.js',
        content: 'console.log("dirty")',
        language: 'javascript',
        isDirty: true,
      },
    ];

    render(<App />);

    expect(beforeCloseHandler).toBeTypeOf('function');
    beforeCloseHandler?.();

    await waitFor(() => {
      expect(mockConfirmClose).toHaveBeenCalledWith(['untitled.js'], 'en');
      expect(mockEditorState.saveTabById).toHaveBeenCalledWith('tab-1');
      expect(mockSaveDialog).not.toHaveBeenCalled();
      expect(mockWrite).not.toHaveBeenCalled();
      expect(mockForceClose).toHaveBeenCalledTimes(1);
    });
  });
});
