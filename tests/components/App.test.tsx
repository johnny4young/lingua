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
  mockTrackEvent,
  mockArmPendingSessionRestoreSnapshot,
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
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
  mockArmPendingSessionRestoreSnapshot: vi.fn(() => 0),
}));

let beforeCloseHandler: (() => void) | undefined;

const mockEditorState = {
  saveActiveTab: vi.fn().mockResolvedValue(undefined),
  saveActiveTabAs: vi.fn().mockResolvedValue(undefined),
  saveTabById: vi.fn().mockResolvedValue(true),
  openFileFromDisk: vi.fn().mockResolvedValue(undefined),
  closeTab: vi.fn().mockResolvedValue(true),
  // RL-101 Slice 1 — `useOnboardingChoreography` calls `addTab`
  // when seeding the welcome scratchpad on a fresh install. Stub
  // it so the hook is a silent no-op in App.test.tsx.
  addTab: vi.fn(),
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
  restoreSessionMode: 'always' as 'never' | 'ask' | 'always',
  lastSeenVersion: null as string | null,
  hasCompletedTour: false,
  suppressTourAutoStart: false,
  setLastSeenVersion: mockSetLastSeenVersion,
  setHasCompletedTour: mockSetHasCompletedTour,
  // RL-101 Slice 1 — onboarding flags + setters consumed by
  // `useOnboardingChoreography`. Default `true` so the welcome
  // seed path does NOT fire during App.test.tsx (the test asserts
  // unrelated boot behaviours and doesn't seed snippets / tabs).
  hasCompletedOnboardingWelcome: true,
  hasCompletedOnboardingFirstRun: true,
  hasCompletedOnboardingFirstSnippet: true,
  onboardingWelcomeSeedVersion: Number.MAX_SAFE_INTEGER,
  markOnboardingWelcomeCompleted: vi.fn(),
  markOnboardingFirstRunCompleted: vi.fn(),
  markOnboardingFirstSnippetCompleted: vi.fn(),
  resetOnboardingWelcome: vi.fn(),
  resetOnboardingFirstRun: vi.fn(),
  resetOnboardingFirstSnippet: vi.fn(),
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

vi.mock('../../src/renderer/components/WebUpdateBanner', () => ({
  WebUpdateBanner: () => <div data-testid="web-update-banner">web-update-banner</div>,
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

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

vi.mock('../../src/renderer/utils/desktopSmoke', () => ({
  desktopSmokeEnabled: () => smokeEnabled,
}));

vi.mock('../../src/renderer/stores/editorStore', () => {
  const useEditorStore = (selector?: (state: typeof mockEditorState) => unknown) =>
    selector ? selector(mockEditorState) : mockEditorState;
  useEditorStore.getState = () => mockEditorState;
  useEditorStore.subscribe = mockEditorSubscribe;
  // RL-101 Slice 1 — `useOnboardingChoreography` imports
  // `createDefaultTab` to construct the seed tab. Stub it to a
  // minimal FileTab-shaped object; tests never assert on the seed
  // contents here.
  const createDefaultTab = (language = 'javascript') => ({
    id: 'mock-tab',
    name: 'mock.js',
    content: '',
    language,
    runtimeMode: 'worker',
    workflowMode: 'scratchpad',
    autoLogEnabled: false,
    stdinBuffer: '',
    isDirty: false,
  });
  const getActiveTab = (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  const getActiveTabIndex = (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.activeTabId == null ? -1 : s.tabs.findIndex((t) => t.id === s.activeTabId);
  return { useEditorStore, createDefaultTab, getActiveTab, getActiveTabIndex };
});

vi.mock('../../src/renderer/stores/pluginStore', () => ({
  usePluginStore: (selector?: (state: { initialize: typeof mockInitializePlugins }) => unknown) => {
    const state = { initialize: mockInitializePlugins };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/renderer/stores/sessionStore', () => ({
  armPendingSessionRestoreSnapshot: mockArmPendingSessionRestoreSnapshot,
  getPendingSessionRestoreTabCount: vi.fn(() => 0),
  clearPendingSessionRestoreSnapshot: vi.fn(),
  useSessionStore: {
    getState: () => ({
      restoreSession: mockRestoreSession,
      saveSession: mockSaveSession,
      // RL-111 — the boot hook reads savedTabs.length for the restore
      // telemetry tabCount and the ask-mode prompt gate.
      savedTabs: [],
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
    mockSettingsState.restoreSessionMode = 'always';
    mockSettingsState.lastSeenVersion = null;
    mockSettingsState.hasCompletedTour = false;
    mockSettingsState.suppressTourAutoStart = false;
    mockEditorState.activeTabId = 'tab-1';
    mockEditorState.tabs = [];
    mockEditorState.saveTabById.mockResolvedValue(true);
    localStorage.clear();

    Object.defineProperty(window, 'lingua', {
      value: {
        platform: 'darwin',
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

  it('fires app.launched on mount and overlay.opened when the first-boot whats-new dialog opens (RL-065)', async () => {
    // Default beforeEach state: lastSeenVersion is null and current
    // version is 0.1.0, so the whats-new overlay opens automatically on
    // first mount. That flow goes through openOverlay which now fires
    // overlay.opened for the consenting-user telemetry.
    render(<App />);

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('app.launched', expect.any(Object));
      expect(mockTrackEvent).toHaveBeenCalledWith('overlay.opened', {
        overlayId: 'whats-new',
      });
    });
  });

  // RL-061 Slice 5 — desktop builds must NOT mount the
  // WebUpdateBanner. The native autoupdater handles updates.
  it('does NOT mount the WebUpdateBanner on desktop builds', async () => {
    render(<App />);
    await waitFor(() => {
      expect(mockGetAppInfo).toHaveBeenCalled();
    });
    expect(document.querySelector('[data-testid="web-update-banner"]')).toBeNull();
  });

  it('mounts the WebUpdateBanner on browser builds where the web adapter defines window.lingua', async () => {
    Object.defineProperty(window, 'lingua', {
      value: {
        ...(window.lingua as unknown as Record<string, unknown>),
        platform: 'web',
      },
      configurable: true,
      writable: true,
    });

    render(<App />);
    await waitFor(() => {
      expect(mockGetAppInfo).toHaveBeenCalled();
    });
    expect(document.querySelector('[data-testid="web-update-banner"]')).not.toBeNull();
  });

  it('shows the factory recovery notice when the boot-loop marker is active', async () => {
    localStorage.setItem('lingua-factory-mode', '1');

    render(<App />);

    await waitFor(() => {
      expect(mockGetAppInfo).toHaveBeenCalled();
    });
    expect(document.querySelector('[data-testid="factory-recovery-notice"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Factory recovery active');
  });
});
