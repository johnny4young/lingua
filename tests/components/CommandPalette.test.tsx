import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { CommandPalette } from '../../src/renderer/components/CommandPalette/CommandPalette';
import {
  _resetCommandBusForTesting,
  subscribeCommand,
} from '../../src/renderer/stores/commandBus';
import {
  armPendingSessionRestoreSnapshot,
  clearPendingSessionRestoreSnapshot,
  useSessionStore,
} from '../../src/renderer/stores/sessionStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useCommandHistoryStore } from '../../src/renderer/stores/commandHistoryStore';
import { setActiveEditor } from '../../src/renderer/runtime/editorAccess';
import { useAiExplainCodeStore } from '../../src/renderer/stores/aiExplainCodeStore';
import { useConsoleStore } from '../../src/renderer/stores/consoleStore';

const { grantedEntitlements } = vi.hoisted(() => ({ grantedEntitlements: new Set<string>() }));
const { dependencyDetectionState, editorState, resultState, settingsState, trackEventMock } =
  vi.hoisted(() => ({
    dependencyDetectionState: {
      byTab: new Map<
        string,
        {
          language: 'javascript' | 'python';
          dependencies: Array<{ name: string; kind: 'import'; status: 'detected' }>;
          skippedReason?: 'buffer-too-large';
        }
      >(),
    },
    editorState: {
      addTab: vi.fn(),
      openFileFromDisk: vi.fn().mockResolvedValue(undefined),
      saveActiveTabAs: vi.fn().mockResolvedValue(undefined),
      duplicateActiveTab: vi.fn(),
      tabs: [] as Array<{
        id: string;
        language: string;
        content: string;
        kind?: 'notebook';
        runtimeMode?: 'worker' | 'node' | 'browser-preview';
        compareWithSnapshotEnabled?: boolean;
        variableInspectorEnabled?: boolean;
      }>,
      activeTabId: null as string | null,
      setTabRuntimeMode: vi.fn(),
      setTabAutoLogEnabled: vi.fn(),
      updateContent: vi.fn(),
      setTabNextRunTimeoutOverride: vi.fn(),
      // Variable inspector palette wiring depends on
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
      // Variable inspector snapshot for palette gate.
      scopeSnapshot: null as null | {
        language: string;
        capturedAt: number;
        variables: Array<{ name: string; value: unknown }>;
      },
    },
    settingsState: {
      featureFlags: {} as Record<string, boolean>,
      shortcutOverrides: {},
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
      dependencyDetectionEnabled: true,
      contextualHintsEnabled: true,
      setContextualHintsEnabled: vi.fn(),
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
    getActiveTab: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
      s.tabs.find(t => t.id === s.activeTabId) ?? null,
    getActiveTabIndex: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
      s.activeTabId == null ? -1 : s.tabs.findIndex(t => t.id === s.activeTabId),
    createDefaultTab: (language: string) => ({
      id: `tab-${language}`,
      name: `untitled-${language}`,
      language,
      content: '',
      isDirty: false,
    }),
  };
});

vi.mock('../../src/renderer/hooks/useEntitlement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/renderer/hooks/useEntitlement')>();
  return {
    ...actual,
    useEntitlement: (entitlement: Parameters<typeof actual.useEntitlement>[0]) => {
      const granted = actual.useEntitlement(entitlement);
      return granted || grantedEntitlements.has(entitlement);
    },
  };
});

vi.mock('../../src/renderer/stores/resultStore', () => {
  const useResultStore = (selector?: (state: typeof resultState) => unknown) =>
    typeof selector === 'function' ? selector(resultState) : resultState;
  useResultStore.getState = () => resultState;
  return { useResultStore };
});

vi.mock('../../src/renderer/stores/dependencyDetectionStore', () => {
  const useDependencyDetectionStore = (
    selector?: (state: typeof dependencyDetectionState) => unknown
  ) =>
    typeof selector === 'function' ? selector(dependencyDetectionState) : dependencyDetectionState;
  useDependencyDetectionStore.getState = () => dependencyDetectionState;
  return { useDependencyDetectionStore };
});

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

vi.mock('../../src/renderer/stores/snippetsStore', () => ({
  // Selector-aware: the palette hook reads `snippets` through a selector.
  useSnippetsStore: (selector?: (state: unknown) => unknown) => {
    const state = { snippets: [] };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/renderer/stores/settingsStore', () => {
  const useSettingsStore = (selector?: (state: typeof settingsState) => unknown) =>
    typeof selector === 'function' ? selector(settingsState) : settingsState;
  useSettingsStore.getState = () => settingsState;
  return { useSettingsStore };
});

vi.mock('../../src/renderer/stores/updateStore', () => {
  const state = {
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    restartToApply: vi.fn().mockResolvedValue(true),
    status: 'idle',
  };
  return {
    // Selector-aware, with a stable state object so useShallow slices
    // compare equal across renders.
    useUpdateStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
  OverlayBackdrop: ({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) => (
    <div onClick={onClose}>{children}</div>
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
  Lightbulb: () => null,
  AppWindow: () => null,
  Braces: () => null,
  History: () => null,
  Wrench: () => null,
  Sparkles: () => null,
  FileSearch: () => null,
}));

describe('CommandPalette', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    grantedEntitlements.clear();
    editorState.tabs = [];
    editorState.activeTabId = null;
    resultState.lastSuccessfulSnapshot = null;
    resultState.snapshotRing = [];
    resultState.scopeSnapshot = null;
    dependencyDetectionState.byTab.clear();
    settingsState.dependencyDetectionEnabled = true;
    settingsState.contextualHintsEnabled = true;
    settingsState.variableInspectorSurface = 'floating';
    settingsState.consoleRichRenderingEnabled = true;
    useSessionStore.setState({ savedTabs: [], savedActiveIndex: -1 });
    clearPendingSessionRestoreSnapshot();
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

  afterEach(() => {
    _resetCommandBusForTesting();
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

    expect(screen.getByPlaceholderText('Buscar plantillas, fragmentos, comandos...')).toBeTruthy();
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

  it('exposes the result count as a polite live region (accessibility pass)', () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );
    const count = screen.getByTestId('command-palette-result-count');
    expect(count.getAttribute('role')).toBe('status');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(count.getAttribute('aria-atomic')).toBe('true');
  });

  it('exposes combobox + listbox semantics with aria-activedescendant (accessibility pass)', () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );
    const input = screen.getByRole('combobox');
    const listbox = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);

    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    const activeOption = document.getElementById(activeId as string);
    expect(activeOption?.getAttribute('role')).toBe('option');
    expect(activeOption?.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps Restore last session visible for a pending ask-mode snapshot after savedTabs changes', () => {
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'previous.js',
          language: 'javascript',
          content: 'console.log("previous")',
        },
      ],
      savedActiveIndex: 0,
    });
    expect(armPendingSessionRestoreSnapshot()).toBe(1);
    useSessionStore.setState({ savedTabs: [], savedActiveIndex: -1 });

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
    fireEvent.change(input, { target: { value: 'restore' } });

    expect(screen.getByText('Restore last session')).toBeTruthy();
  });

  it('keeps the five primary tasks within a three-step palette interaction budget', () => {
    editorState.tabs = [
      {
        id: 'tab-1',
        language: 'javascript',
        content: 'console.log("ready")',
        runtimeMode: 'worker',
      },
    ];
    editorState.activeTabId = 'tab-1';
    const runActiveTab = vi.fn();
    const openProject = vi.fn().mockResolvedValue(undefined);
    const applyLicense = vi.fn();
    const restoreSession = vi.fn().mockResolvedValue(undefined);
    const originalRestoreSession = useSessionStore.getState().restoreSession;
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'previous.js',
          language: 'javascript',
          content: 'console.log("previous")',
        },
      ],
      savedActiveIndex: 0,
      restoreSession,
    });

    const cases = [
      {
        query: 'run active tab',
        props: { onRunActiveTab: runActiveTab },
        assertAction: () => expect(runActiveTab).toHaveBeenCalledOnce(),
      },
      {
        query: 'switch runtime to node',
        props: {},
        assertAction: () =>
          expect(editorState.setTabRuntimeMode).toHaveBeenCalledWith('tab-1', 'node'),
      },
      {
        query: 'open project folder',
        props: { onOpenProject: openProject },
        assertAction: () => expect(openProject).toHaveBeenCalledOnce(),
      },
      {
        query: 'apply license token',
        props: { onApplyLicense: applyLicense },
        assertAction: () => expect(applyLicense).toHaveBeenCalledOnce(),
      },
      {
        query: 'restore last session',
        props: {},
        assertAction: () => expect(restoreSession).toHaveBeenCalledOnce(),
      },
    ] as const;

    try {
      for (const task of cases) {
        const onClose = vi.fn();
        let steps = 1; // Open the palette with its global shortcut.
        const view = render(
          <CommandPalette
            onClose={onClose}
            onOpenSettings={vi.fn()}
            onOpenWhatsNew={vi.fn()}
            onStartGuidedTour={vi.fn()}
            onOpenSnippets={vi.fn()}
            {...task.props}
          />
        );
        const input = screen.getByPlaceholderText(
          'Search templates, snippets, commands...'
        );

        fireEvent.change(input, { target: { value: task.query } });
        steps += 1;
        fireEvent.keyDown(input, { key: 'Enter' });
        steps += 1;

        expect(steps).toBeLessThanOrEqual(3);
        expect(onClose).toHaveBeenCalledOnce();
        task.assertAction();
        view.unmount();
      }
    } finally {
      useSessionStore.setState({ restoreSession: originalRestoreSession });
    }
  });

  it('shows why a selection command is unavailable without a selection', () => {
    editorState.tabs = [{ id: 'sel-js', language: 'javascript', content: 'const a = 1;', runtimeMode: 'worker' }];
    editorState.activeTabId = 'sel-js';
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Search templates, snippets, commands...'), {
      target: { value: 'copy with context' },
    });
    expect(screen.getAllByText('Select code in the editor first.').length).toBeGreaterThan(0);
  });

  it('describes desktop runtimes honestly in the web command palette', () => {
    const originalLingua = window.lingua;
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      value: { platform: 'web' },
    });
    try {
      editorState.tabs = [{
        id: 'web-js',
        language: 'javascript',
        content: 'console.log(1)',
        runtimeMode: 'worker',
      }];
      editorState.activeTabId = 'web-js';
      render(
        <CommandPalette
          onClose={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenWhatsNew={vi.fn()}
          onStartGuidedTour={vi.fn()}
          onOpenSnippets={vi.fn()}
        />
      );
      fireEvent.change(screen.getByPlaceholderText('Search templates, snippets, commands...'), {
        target: { value: 'runtime to Node' },
      });
      expect(screen.getByText(/Desktop only\. This runtime cannot execute in the web app/)).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'lingua', {
        configurable: true,
        value: originalLingua,
      });
    }
  });

  it('keeps filtered results under their group eyebrows and counts shown of total', () => {
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

    expect(screen.getByTestId('command-palette-group-commands')).toBeTruthy();
    expect(screen.queryByTestId('command-palette-group-recent')).toBeNull();
    expect(screen.getByTestId('command-palette-result-count').textContent).toMatch(
      /^\d+ of \d+ results$/
    );
  });

  it('jumps between groups with Tab and Shift+Tab', () => {
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
    const selectedGroup = () => {
      const active = document.querySelector('[role="option"][aria-selected="true"]');
      let node = active?.previousElementSibling ?? null;
      while (node && !node.getAttribute('data-testid')?.startsWith('command-palette-group-')) {
        node = node.previousElementSibling;
      }
      return node?.getAttribute('data-testid');
    };

    const first = selectedGroup();
    fireEvent.keyDown(input, { key: 'Tab' });
    const second = selectedGroup();
    expect(second).not.toBe(first);
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(selectedGroup()).toBe(first);
  });

  it('shows a command shortcut as a keycap instead of inside its description', () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Search templates, snippets, commands...'), {
      target: { value: 'settings' },
    });
    const row = screen.getAllByRole('option').find(option => /Open settings/i.test(option.textContent ?? ''));
    expect(row).toBeTruthy();
    expect(row?.querySelector('[data-testid="command-palette-keycaps"] kbd')?.textContent).toMatch(/,/);
    // The Enter keycap on the active row stays out of its accessible name.
    const active = document.querySelector('[role="option"][aria-selected="true"]');
    expect(active?.querySelector('[aria-hidden="true"] kbd')?.textContent).toBe('↵');
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
    expect(screen.getByText(/Try (⌘P|Ctrl\+P) to jump to a file/i)).toBeTruthy();
    expect(screen.getByTestId('contextual-hint-palette')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Don't show tips" }));
    expect(settingsState.setContextualHintsEnabled).toHaveBeenCalledWith(false);
  });

  it('hides palette guidance when contextual tips are disabled', () => {
    settingsState.contextualHintsEnabled = false;
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
    fireEvent.change(input, { target: { value: 'zzzzzzzz-no-such-thing' } });

    expect(screen.queryByTestId('contextual-hint-palette')).toBeNull();
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
      screen.getByRole('option', {
        name: /Toggle compare with last stable run/i,
      })
    );

    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'compare',
      consoleVisible: true,
    });
    expect(trackEventMock).toHaveBeenCalledWith('runtime.compare_view_toggled', {
      language: 'javascript',
      enabled: true,
    });
  });

  // The "Toggle rich console output" palette action was
  // removed; rich rendering is baseline (charts/tables/images render
  // unconditionally when the worker emits a payload).

  it.each([
    ['source', undefined, true],
    ['notebook', 'notebook' as const, false],
  ])('offers buffer-editing actions only for source tabs (%s)', (_label, kind, offered) => {
    grantedEntitlements.add('BENCHMARK');
    editorState.tabs = [
      { id: 'tab-1', language: 'javascript', content: '{"format":"linguanb"}', kind },
    ];
    editorState.activeTabId = 'tab-1';
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
    for (const [query, name] of [
      ['pin watch', /Pin watch on current line/i],
      ['benchmark', /Benchmark/i],
    ] as const) {
      fireEvent.change(input, { target: { value: query } });
      expect(screen.queryByRole('option', { name }) !== null).toBe(offered);
    }
  });

  it('hides the share-link action when no tab is active', () => {
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
    fireEvent.change(input, { target: { value: 'share link' } });

    expect(
      screen.queryByRole('button', {
        name: /Copy share link/i,
      })
    ).toBeNull();
  });

  it('emits the share-link trigger from the palette when a tab is active', () => {
    editorState.tabs = [
      {
        id: 'tab-1',
        language: 'javascript',
        content: 'console.log("share")',
      },
    ];
    editorState.activeTabId = 'tab-1';
    const listener = vi.fn();
    const unsubscribe = subscribeCommand('share.trigger', listener);

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
    fireEvent.change(input, { target: { value: 'share link' } });
    fireEvent.click(
      screen.getByRole('option', {
        name: /Copy share link/i,
      })
    );

    expect(listener).toHaveBeenCalledWith({ trigger: 'palette' }, expect.any(Object));
    unsubscribe();
  });

  it('hides the dependencies action when no dependency panel state is available', () => {
    editorState.tabs = [
      {
        id: 'tab-1',
        language: 'javascript',
        content: 'console.log(1)',
      },
    ];
    editorState.activeTabId = 'tab-1';

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
    fireEvent.change(input, { target: { value: 'dependencies' } });

    expect(screen.queryByRole('button', { name: /Show dependencies/i })).toBeNull();
  });

  it('opens the dependencies panel from the palette when rows are detected', () => {
    const onClose = vi.fn();
    editorState.tabs = [
      {
        id: 'tab-1',
        language: 'javascript',
        content: "import x from 'lodash';",
      },
    ];
    editorState.activeTabId = 'tab-1';
    dependencyDetectionState.byTab.set('tab-1', {
      language: 'javascript',
      dependencies: [{ name: 'lodash', kind: 'import', status: 'detected' }],
    });

    render(
      <CommandPalette
        onClose={onClose}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(input, { target: { value: 'dependencies' } });
    fireEvent.click(screen.getByRole('option', { name: /Show dependencies/i }));

    expect(onClose).toHaveBeenCalled();
    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'dependencies',
      consoleVisible: true,
    });
  });

  it('hides the dependencies action when the cached entry belongs to an old language', () => {
    editorState.tabs = [
      {
        id: 'tab-1',
        language: 'javascript',
        content: "import x from 'lodash';",
      },
    ];
    editorState.activeTabId = 'tab-1';
    dependencyDetectionState.byTab.set('tab-1', {
      language: 'python',
      dependencies: [{ name: 'numpy', kind: 'import', status: 'detected' }],
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
    fireEvent.change(input, { target: { value: 'dependencies' } });

    expect(screen.queryByRole('button', { name: /Show dependencies/i })).toBeNull();
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
      screen.getByRole('option', {
        name: /Toggle variable inspector/i,
      })
    );

    expect(editorState.setTabVariableInspectorEnabled).toHaveBeenCalledWith('tab-1', true);
    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'variables',
      consoleVisible: true,
    });
  });

  // ─── Recent commands stack ───────────────────────────────

  it('records executed actions into the per-session command history', () => {
    useCommandHistoryStore.getState()._clearForTesting();
    const onOpenSettings = vi.fn();
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={onOpenSettings}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(input, { target: { value: 'Open settings' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    const entries = useCommandHistoryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBeTruthy();
  });

  it('renders the recent variant with numbered slots and runs slot 1 via the 1 key', () => {
    useCommandHistoryStore.getState()._clearForTesting();
    const onOpenSettings = vi.fn();

    // Seed the history through a real palette execution so the recorded
    // id matches the live model.
    const first = render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={onOpenSettings}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );
    const searchInput = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(searchInput, { target: { value: 'Open settings' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    first.unmount();

    render(
      <CommandPalette
        variant="recent"
        onClose={vi.fn()}
        onOpenSettings={onOpenSettings}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    // The stack shows the executed command in slot 1 with a timestamp.
    expect(screen.getAllByTestId('recent-command-slot')[0]!.textContent).toBe('1');
    expect(screen.getAllByTestId('recent-command-time').length).toBeGreaterThan(0);

    const recentInput = screen.getByPlaceholderText(
      'Press 1-8 to run again, Enter for the most recent…'
    );
    fireEvent.keyDown(recentInput, { key: '1' });
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when no commands ran this session', () => {
    useCommandHistoryStore.getState()._clearForTesting();
    render(
      <CommandPalette
        variant="recent"
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );
    expect(screen.getByText('No commands run yet this session.')).toBeTruthy();
    expect(screen.queryByTestId('contextual-hint-palette')).toBeNull();
  });
});

describe('CommandPalette autodetect (Labs)', () => {
  const fakeEditor = {
    getModel: () => ({ getValue: () => 'print(sorted(xs))', getValueInRange: () => '' }),
    getSelection: () => ({ isEmpty: () => true }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    grantedEntitlements.clear();
    grantedEntitlements.add('LOCAL_AI');
    settingsState.featureFlags = { paletteAutodetect: true };
    editorState.tabs = [{ id: 'tab-py', language: 'python', content: 'print(sorted(xs))', name: 'main.py' } as never];
    editorState.activeTabId = 'tab-py';
    setActiveEditor(fakeEditor as never);
    useAiExplainCodeStore.setState({ request: null });
    useConsoleStore.setState({ entries: [] } as never);
    (resultState as { ranCode?: unknown; error?: unknown }).ranCode = null;
    (resultState as { error?: unknown }).error = null;
  });

  afterEach(() => {
    settingsState.featureFlags = {};
    setActiveEditor(null);
  });

  function renderPalette(extra: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
    const onClose = vi.fn();
    render(
      <CommandPalette
        onClose={onClose}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
        {...extra}
      />
    );
    return { onClose, input: screen.getByRole('combobox') };
  }

  it('sends a question to Explain this code with the last run attached', () => {
    (resultState as { ranCode?: unknown }).ranCode = { tabId: 'tab-py', code: '', input: '', at: 1 };
    (resultState as { error?: unknown }).error = { message: 'NameError: xs' };
    useConsoleStore.setState({
      entries: [
        { id: '0', type: 'info', content: 'Running main.py...', timestamp: 1 },
        { id: '1', type: 'log', content: 'start', timestamp: 1 },
        { id: '2', type: 'info', content: 'note', timestamp: 1, line: 2 },
      ],
    } as never);
    const { onClose, input } = renderPalette();
    fireEvent.change(input, { target: { value: 'why does sorted drop duplicates' } });
    expect(screen.getByTestId('command-palette-autodetect').textContent).toContain('(autodetected · question)');
    expect(screen.getByTestId('command-palette-group-autodetected')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useAiExplainCodeStore.getState().request).toEqual({
      code: 'print(sorted(xs))',
      language: 'python',
      filename: 'main.py',
      question: 'why does sorted drop duplicates',
      lastRun: 'start\nnote\nError: NameError: xs',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('attaches no run when the results belong to another tab', () => {
    (resultState as { ranCode?: unknown }).ranCode = { tabId: 'tab-other', code: '', input: '', at: 1 };
    useConsoleStore.setState({ entries: [{ id: '1', type: 'log', content: 'other tab', timestamp: 1 }] } as never);
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: 'why does this fail?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useAiExplainCodeStore.getState().request).not.toHaveProperty('lastRun');
  });

  it('opens Quick Open with a file name typed in', () => {
    const onOpenQuickOpen = vi.fn();
    const { input } = renderPalette({ onOpenQuickOpen });
    fireEvent.change(input, { target: { value: 'main.py' } });
    expect(screen.getByTestId('command-palette-autodetect').textContent).toContain('(autodetected · file)');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOpenQuickOpen).toHaveBeenCalledWith('main.py');
  });

  it('searches commands only after !', () => {
    const { input } = renderPalette({ onOpenQuickOpen: vi.fn() });
    fireEvent.change(input, { target: { value: '!why does sorted drop duplicates' } });
    expect(screen.queryByTestId('command-palette-autodetect')).toBeNull();
    expect(screen.queryByTestId('command-palette-group-autodetected')).toBeNull();
    fireEvent.change(input, { target: { value: '!settings' } });
    expect(screen.getAllByRole('option').some(option => /settings/i.test(option.textContent ?? ''))).toBe(true);
  });

  it('detects nothing without Pro or with the flag off', () => {
    grantedEntitlements.clear();
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: 'why does sorted drop duplicates' } });
    expect(screen.queryByTestId('command-palette-group-autodetected')).toBeNull();
  });

  it('stays a plain command search with the flag off', () => {
    settingsState.featureFlags = {};
    const { input } = renderPalette({ onOpenQuickOpen: vi.fn() });
    fireEvent.change(input, { target: { value: 'main.py' } });
    expect(screen.queryByTestId('command-palette-autodetect')).toBeNull();
  });
});
