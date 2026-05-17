import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { CommandPalette } from '../../src/renderer/components/CommandPalette/CommandPalette';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const { editorState, resultState, settingsState, trackEventMock } = vi.hoisted(() => ({
  editorState: {
    addTab: vi.fn(),
    openFileFromDisk: vi.fn().mockResolvedValue(undefined),
    saveActiveTabAs: vi.fn().mockResolvedValue(undefined),
    duplicateActiveTab: vi.fn(),
    tabs: [] as Array<{
      id: string;
      language: string;
      content: string;
      runtimeMode?: 'worker' | 'node' | 'browser-preview';
      compareWithSnapshotEnabled?: boolean;
      variableInspectorEnabled?: boolean;
    }>,
    activeTabId: null as string | null,
    setTabRuntimeMode: vi.fn(),
    setTabAutoLogEnabled: vi.fn(),
    updateContent: vi.fn(),
    setTabNextRunTimeoutOverride: vi.fn(),
    setTabCompareEnabled: vi.fn(),
    // RL-020 Slice 9 — variable inspector palette wiring depends on
    // the setter being present even when not exercised.
    setTabVariableInspectorEnabled: vi.fn(),
  },
  resultState: {
    lastSuccessfulSnapshot: null as null | {
      lineResults: unknown[];
      fullOutput: string;
      stdinConsumed: null;
      executionTime: number | null;
      language: string;
      capturedAt: number;
    },
    snapshotRing: [] as Array<{
      lineResults: unknown[];
      fullOutput: string;
      stdinConsumed: null;
      executionTime: number | null;
      language: string;
      capturedAt: number;
    }>,
    // RL-020 Slice 9 — variable inspector snapshot for palette gate.
    scopeSnapshot: null as null | {
      language: string;
      capturedAt: number;
      variables: Array<{ name: string; value: unknown }>;
    },
  },
  settingsState: {
    setLayoutPreset: vi.fn(),
    vimMode: false,
    showStdinPanel: true,
    variableInspectorSurface: 'floating' as 'floating' | 'bottom',
    scratchpadAutoLogByLanguage: { javascript: false, typescript: false },
    runtimeTimeoutPresetByLanguage: {
      javascript: 'normal',
      typescript: 'normal',
      python: 'long',
      go: 'normal',
    },
    setRuntimeTimeoutPreset: vi.fn(),
  },
  trackEventMock: vi.fn(),
}));

vi.mock('../../src/renderer/data/templates', () => ({
  BUILT_IN_TEMPLATES: [
    {
      id: 'js-hello',
      language: 'javascript',
      labelKey: 'templates.helloWorld.label',
      descriptionKey: 'templates.helloWorld.description',
      fileStemKey: 'templates.helloWorld.fileStem',
      content: 'console.log("hi")',
    },
  ],
  resolveTemplateFileStem: () => 'untitled',
  resolveTemplateLabel: () => 'Hello world',
  resolveTemplateDescription: () => 'Print a greeting',
}));

vi.mock('../../src/renderer/stores/editorStore', () => {
  // Selector-aware mock: support both `useEditorStore()` and
  // `useEditorStore((state) => state.something)` call shapes.
  const useEditorStore = (selector?: (state: typeof editorState) => unknown) => {
    return typeof selector === 'function' ? selector(editorState) : editorState;
  };
  useEditorStore.getState = () => editorState;
  return {
    useEditorStore,
    createDefaultTab: (language: string) => ({
      id: `tab-${language}`,
      name: `untitled-${language}`,
      language,
      content: '',
      isDirty: false,
    }),
  };
});

vi.mock('../../src/renderer/stores/resultStore', () => {
  const useResultStore = (selector?: (state: typeof resultState) => unknown) =>
    typeof selector === 'function' ? selector(resultState) : resultState;
  useResultStore.getState = () => resultState;
  return { useResultStore };
});

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

vi.mock('../../src/renderer/stores/snippetsStore', () => ({
  useSnippetsStore: () => ({
    snippets: [],
  }),
}));

vi.mock('../../src/renderer/stores/settingsStore', () => {
  const useSettingsStore = (
    selector?: (state: typeof settingsState) => unknown
  ) => (typeof selector === 'function' ? selector(settingsState) : settingsState);
  useSettingsStore.getState = () => settingsState;
  return { useSettingsStore };
});

vi.mock('../../src/renderer/stores/updateStore', () => ({
  useUpdateStore: () => ({
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    restartToApply: vi.fn().mockResolvedValue(true),
    status: 'idle',
  }),
}));

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
  OverlayBackdrop: ({
    children,
    onClose,
  }: {
    children: React.ReactNode;
    onClose?: () => void;
  }) => (
    <div onClick={onClose}>
      {children}
    </div>
  ),
  OverlayCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../src/renderer/components/ui/keyboard', () => ({
  handleCloseOnEscape: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  Search: () => null,
  X: () => null,
  Code: () => null,
  FileCode: () => null,
  Zap: () => null,
}));

describe('CommandPalette', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    editorState.tabs = [];
    editorState.activeTabId = null;
    resultState.lastSuccessfulSnapshot = null;
    resultState.snapshotRing = [];
    resultState.scopeSnapshot = null;
    settingsState.variableInspectorSurface = 'floating';
    useUIStore.setState({
      activeBottomPanel: 'console',
      consoleVisible: false,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    await i18next.changeLanguage('en');
  });

  it('renders localized command palette UI in Spanish', async () => {
    await i18next.changeLanguage('es');

    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    expect(
      screen.getByPlaceholderText('Buscar plantillas, fragmentos, comandos...')
    ).toBeTruthy();
    expect(screen.getByText('navegar')).toBeTruthy();
    expect(screen.getByText('seleccionar')).toBeTruthy();
    expect(screen.getByText(/\d+ resultados/)).toBeTruthy();
  });

  it('exposes the clear search action with an accessible label', async () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');

    fireEvent.change(input, { target: { value: 'set' } });

    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
  });

  it('groups commands by category with eyebrow headers when the search is empty', () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    // Both Actions (layout / settings / etc — built into the palette
    // unconditionally) and Templates (one mocked above) should appear
    // as eyebrow scopes. Snippets bucket is empty in this fixture, so
    // its header must NOT render.
    expect(screen.getByText('Actions')).toBeTruthy();
    expect(screen.getByText('Templates')).toBeTruthy();
    expect(screen.queryByText('Snippets')).toBeNull();
  });

  it('flattens results without scope headers when the user types a query', () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(input, { target: { value: 'layout' } });

    // Search results are intentionally flat; splitting a ranked list
    // across sections would push exact matches below near-misses from
    // a different category.
    expect(screen.queryByText('Actions')).toBeNull();
    expect(screen.queryByText('Templates')).toBeNull();
    expect(screen.queryByText('Snippets')).toBeNull();
  });

  it('renders a hint alongside the empty state when a query has zero matches', () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(input, {
      target: { value: 'zzzzzzzz-no-such-thing' },
    });

    // The new hint nudges the user toward Cmd+P or clearing the
    // query — partial match keeps the assertion resilient to copy
    // tweaks.
    expect(screen.queryByText(/Cmd\+P|clear the search/i)).toBeTruthy();
  });

  it('scrolls the highlighted command row instead of a grouped section header', async () => {
    const scrolledIndexes: string[] = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(function scrollIntoView(this: HTMLElement) {
        scrolledIndexes.push(this.dataset.resultIndex ?? 'missing');
      }),
      configurable: true,
      writable: true,
    });

    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(scrolledIndexes[scrolledIndexes.length - 1]).toBe('1');
    });
  });

  it('fires compare telemetry from the palette toggle action', () => {
    const snapshot = {
      lineResults: [],
      fullOutput: '',
      stdinConsumed: null,
      executionTime: 1,
      language: 'javascript',
      capturedAt: 1,
    };
    editorState.tabs = [
      {
        id: 'tab-1',
        language: 'javascript',
        content: '1 + 1',
      },
    ];
    editorState.activeTabId = 'tab-1';
    resultState.lastSuccessfulSnapshot = snapshot;
    resultState.snapshotRing = [snapshot];

    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(input, { target: { value: 'compare' } });
    fireEvent.click(
      screen.getByRole('button', {
        name: /Toggle compare with last stable run/i,
      })
    );

    expect(editorState.setTabCompareEnabled).toHaveBeenCalledWith(
      'tab-1',
      true
    );
    expect(trackEventMock).toHaveBeenCalledWith(
      'runtime.compare_view_toggled',
      { language: 'javascript', enabled: true }
    );
  });

  it('hides the variable inspector action while the active tab is in Node mode', () => {
    editorState.tabs = [
      {
        id: 'tab-1',
        language: 'javascript',
        content: 'const value = 1',
        runtimeMode: 'node',
      },
    ];
    editorState.activeTabId = 'tab-1';
    resultState.scopeSnapshot = {
      language: 'javascript',
      capturedAt: 1,
      variables: [
        {
          name: 'value',
          value: { kind: 'primitive', type: 'number', repr: '1' },
        },
      ],
    };

    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(input, { target: { value: 'variables' } });

    expect(
      screen.queryByRole('button', {
        name: /Toggle variable inspector/i,
      })
    ).toBeNull();
  });

  it('opens the bottom Variables drawer from the palette when bottom mode is selected', () => {
    settingsState.variableInspectorSurface = 'bottom';
    editorState.tabs = [
      {
        id: 'tab-1',
        language: 'javascript',
        content: 'const value = 1',
      },
    ];
    editorState.activeTabId = 'tab-1';
    resultState.scopeSnapshot = {
      language: 'javascript',
      capturedAt: 1,
      variables: [
        {
          name: 'value',
          value: { kind: 'primitive', type: 'number', repr: '1' },
        },
      ],
    };

    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(input, { target: { value: 'variables' } });
    fireEvent.click(
      screen.getByRole('button', {
        name: /Toggle variable inspector/i,
      })
    );

    expect(editorState.setTabVariableInspectorEnabled).toHaveBeenCalledWith(
      'tab-1',
      true
    );
    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'variables',
      consoleVisible: true,
    });
  });
});
