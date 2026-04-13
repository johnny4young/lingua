import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
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
}));

let beforeCloseHandler: (() => void) | undefined;

const mockEditorState = {
  saveActiveTab: vi.fn().mockResolvedValue(undefined),
  saveActiveTabAs: vi.fn().mockResolvedValue(undefined),
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
};

vi.mock('../../src/renderer/components/Layout', () => ({
  AppLayout: () => <div data-testid="app-layout">layout</div>,
}));

vi.mock('../../src/renderer/components/Settings/SettingsModal', () => ({
  SettingsModal: () => <div>settings</div>,
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
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

vi.mock('../../src/renderer/stores/uiStore', () => ({
  useUIStore: () => ({
    toggleSidebar: vi.fn(),
    toggleConsole: vi.fn(),
  }),
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
    mockSettingsState.restoreSession = true;
    mockEditorState.activeTabId = 'tab-1';
    mockEditorState.tabs = [];

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
      expect(mockConfirmClose).toHaveBeenCalledWith(['untitled.js']);
      expect(mockSaveDialog).toHaveBeenCalledWith('untitled.js');
      expect(mockWrite).toHaveBeenCalledWith('/saved/untitled.js', 'console.log("dirty")');
      expect(mockForceClose).toHaveBeenCalledTimes(1);
    });
  });
});
