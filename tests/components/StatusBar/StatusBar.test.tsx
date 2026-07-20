/**
 * internal — `<StatusBar>` render + interaction contract.
 *
 * Covers:
 *   - Unmounts entirely when `showStatusBar` is false; mounts when true.
 *   - Language / cursor / indent / lint segments render their content.
 *   - Lint shows "No problems" at 0/0 and the errors/warnings copy otherwise.
 *   - Git segment hides with no posture and shows the branch when available.
 *   - Clicking the language segment cycles the active tab's language.
 *   - `defaultShowStatusBar()` is true on desktop, false otherwise.
 *   - `setShowStatusBar` flips state AND emits `editor.status_bar_toggled`.
 *
 * The editor-derived data (cursor, indent, markers) is driven through a stub
 * `editorAccess` module so the test never needs a live Monaco instance.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as monacoTypes from 'monaco-editor';

// ---------------------------------------------------------------------------
// editorAccess stub — controls what the status-bar model hook reads.
// ---------------------------------------------------------------------------

type EditorListener = (
  editor: monacoTypes.editor.IStandaloneCodeEditor | null
) => void;

const editorAccessState = vi.hoisted(() => ({
  editor: null as unknown,
  monaco: null as unknown,
  cursor: null as { line: number; column: number } | null,
  listeners: new Set<EditorListener>(),
}));

vi.mock('../../../src/renderer/runtime/editorAccess', () => ({
  getActiveEditor: () => editorAccessState.editor,
  getActiveMonaco: () => editorAccessState.monaco,
  getActiveEditorCursorPosition: () => editorAccessState.cursor,
  subscribeActiveEditor: (listener: EditorListener) => {
    editorAccessState.listeners.add(listener);
    return () => editorAccessState.listeners.delete(listener);
  },
}));

import { StatusBar } from '../../../src/renderer/components/StatusBar/StatusBar';
import { defaultShowStatusBar } from '../../../src/renderer/stores/settingsDefaults';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useGitStore } from '../../../src/renderer/stores/gitStore';
import { useResultStore } from '../../../src/renderer/stores/resultStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import * as telemetry from '../../../src/renderer/utils/telemetry';

const SETTINGS_INITIAL = useSettingsStore.getState();
const EDITOR_INITIAL = useEditorStore.getState();

function seedTab(language = 'javascript') {
  useEditorStore.setState({
    tabs: [
      {
        id: 'tab-1',
        name: `untitled.${language === 'javascript' ? 'js' : 'txt'}`,
        language,
        content: '',
        isDirty: false,
      },
    ],
    activeTabId: 'tab-1',
  });
}

/**
 * A minimal Monaco editor stub exposing only what `useStatusBarModel` and the
 * indent/lint segments touch: cursor position, model options, markers, and the
 * three `onDid*` listener registrars (returning disposables).
 */
function makeEditorStub(opts: {
  insertSpaces?: boolean;
  tabSize?: number;
} = {}) {
  const model = {
    uri: { toString: () => 'inmemory://model/1' },
    getOptions: () => ({
      insertSpaces: opts.insertSpaces ?? true,
      tabSize: opts.tabSize ?? 2,
    }),
    updateOptions: vi.fn(),
  };
  return {
    getModel: () => model,
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    onDidChangeCursorPosition: () => ({ dispose: vi.fn() }),
    onDidChangeModel: () => ({ dispose: vi.fn() }),
    trigger: vi.fn(),
  } as unknown as monacoTypes.editor.IStandaloneCodeEditor;
}

function makeMonacoStub(markers: Array<{ severity: number }> = []) {
  return {
    MarkerSeverity: { Error: 8, Warning: 4 },
    editor: {
      getModelMarkers: () => markers,
      onDidChangeMarkers: () => ({ dispose: vi.fn() }),
    },
  } as unknown as typeof monacoTypes;
}

describe('StatusBar', () => {
  const originalOnlineDescriptor = Object.getOwnPropertyDescriptor(
    window.navigator,
    'onLine'
  );

  beforeEach(() => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    editorAccessState.editor = null;
    editorAccessState.monaco = null;
    editorAccessState.cursor = null;
    editorAccessState.listeners.clear();
    useGitStore.getState().clear();
    useResultStore.setState({ runTermination: null, runDeadlineAt: null });
    useSettingsStore.setState({ showStatusBar: true });
    seedTab('javascript');
  });

  afterEach(() => {
    if (originalOnlineDescriptor) {
      Object.defineProperty(
        window.navigator,
        'onLine',
        originalOnlineDescriptor
      );
    } else {
      Reflect.deleteProperty(window.navigator, 'onLine');
    }
    useSettingsStore.setState(SETTINGS_INITIAL, true);
    useEditorStore.setState(EDITOR_INITIAL, true);
    vi.restoreAllMocks();
  });

  it('renders nothing and does not subscribe to the editor when showStatusBar is false', () => {
    useSettingsStore.setState({ showStatusBar: false });
    render(<StatusBar />);
    expect(screen.queryByTestId('status-bar')).toBeNull();
    expect(editorAccessState.listeners.size).toBe(0);
  });

  it('renders the bar with language, cursor, encoding and indent segments', () => {
    editorAccessState.editor = makeEditorStub();
    editorAccessState.cursor = { line: 3, column: 7 };
    render(<StatusBar />);

    expect(screen.queryByTestId('status-bar')).not.toBeNull();
    expect(screen.getByTestId('status-bar-language').textContent).toContain('JavaScript');
    expect(screen.getByTestId('status-bar-cursor').textContent).toContain('Ln 3, Col 7');
    expect(screen.getByTestId('status-bar-encoding').textContent).toContain('UTF-8');
    expect(screen.getByTestId('status-bar-indent').textContent).toContain('Spaces: 2');
  });

  it('keeps every visible segment keyboard-focusable per the internal acceptance criteria', () => {
    editorAccessState.editor = makeEditorStub();
    act(() => {
      useGitStore.getState().setPosture({
        available: true,
        repoRoot: '/tmp/repo',
        branch: 'feature/internal',
        commit: 'abcdef1234567890',
      });
    });
    render(<StatusBar />);

    for (const id of [
      'status-bar-language',
      'status-bar-lint',
      'status-bar-cursor',
      'status-bar-encoding',
      'status-bar-indent',
      'status-bar-git',
      'status-bar-run',
    ]) {
      const segment = screen.getByTestId(id);
      expect(segment.tagName).toBe('BUTTON');
      expect(segment.hasAttribute('disabled')).toBe(false);
      // accessibility pass — every segment carries the shared visible focus ring.
      expect(segment.className).toContain('focus-ring');
    }
  });

  it('exposes informational content as status semantics without replacing segment buttons', () => {
    editorAccessState.editor = makeEditorStub();
    editorAccessState.monaco = makeMonacoStub([]);
    editorAccessState.cursor = { line: 3, column: 7 };
    useResultStore.setState({ runTermination: { kind: 'error' } });
    act(() => {
      useGitStore.getState().setPosture({
        available: true,
        repoRoot: '/tmp/repo',
        branch: 'feature/internal',
        commit: 'abcdef1234567890',
      });
    });
    render(<StatusBar />);

    for (const id of ['lint', 'cursor', 'encoding', 'git', 'run']) {
      const segment = screen.getByTestId(`status-bar-${id}`);
      const status = screen.getByTestId(`status-bar-${id}-status`);
      expect(segment.tagName).toBe('BUTTON');
      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-atomic')).toBe('true');
      expect(segment.getAttribute('aria-labelledby')).toBe(`status-bar-${id}-status`);
      expect(segment.contains(status)).toBe(false);
    }

    expect(screen.getByTestId('status-bar-lint-status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('status-bar-cursor-status').getAttribute('aria-live')).toBe('off');
    expect(screen.getByTestId('status-bar-encoding-status').getAttribute('aria-live')).toBe('off');
    expect(screen.getByTestId('status-bar-git-status').getAttribute('aria-live')).toBe('off');
    expect(screen.getByTestId('status-bar-run-status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('status-bar-run-status').textContent).toBe('Run status: Error');
  });

  it('celebrates offline capability and disappears immediately when connectivity returns', () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    render(<StatusBar />);

    const offline = screen.getByTestId('status-bar-offline');
    expect(offline.tagName).toBe('BUTTON');
    expect(offline.className).toContain('focus-ring');
    expect(offline.className).toContain('text-success-fg');
    expect(offline.textContent).toContain(
      'Offline — everything keeps working'
    );
    expect(offline.getAttribute('title')).toBe(
      'Offline: local and cached runtimes keep working. Updates, remote AI, and uncached runtime downloads are unavailable.'
    );
    expect(offline.getAttribute('aria-labelledby')).toBe('status-bar-offline-status');
    expect(screen.getByTestId('status-bar-offline-status').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('status-bar-offline-status').getAttribute('aria-live')).toBe(
      'polite'
    );
    expect(screen.getByTestId('status-bar-offline-status').textContent).toContain(
      'Offline — everything keeps working'
    );

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    act(() => window.dispatchEvent(new Event('online')));

    expect(screen.queryByTestId('status-bar-offline')).toBeNull();
    expect(screen.getByTestId('status-bar-run').className).toContain('ml-auto');
  });

  it('shows "No problems" when there are no markers', () => {
    editorAccessState.editor = makeEditorStub();
    editorAccessState.monaco = makeMonacoStub([]);
    render(<StatusBar />);
    expect(screen.getByTestId('status-bar-lint').textContent).toContain('No problems');
  });

  it('shows error + warning counts when markers are present', () => {
    editorAccessState.editor = makeEditorStub();
    editorAccessState.monaco = makeMonacoStub([
      { severity: 8 },
      { severity: 8 },
      { severity: 4 },
    ]);
    render(<StatusBar />);
    const lint = screen.getByTestId('status-bar-lint');
    expect(lint.textContent).toContain('2 errors');
    expect(lint.textContent).toContain('1 warning');
    expect(lint.getAttribute('data-lint-errors')).toBe('2');
    expect(lint.getAttribute('data-lint-warnings')).toBe('1');
  });

  it('hides the Git segment when there is no posture', () => {
    render(<StatusBar />);
    expect(screen.queryByTestId('status-bar-git')).toBeNull();
  });

  it('shows the Git segment with the branch when posture is available', () => {
    act(() => {
      useGitStore.getState().setPosture({
        available: true,
        repoRoot: '/tmp/repo',
        branch: 'feature/internal',
        commit: 'abcdef1234567890',
      });
    });
    render(<StatusBar />);
    const git = screen.getByTestId('status-bar-git');
    expect(git.textContent).toContain('feature/internal');
    expect(git.getAttribute('title')).toBe('feature/internal · abcdef1');
  });

  it('cycles the active tab language when the language segment is clicked', () => {
    render(<StatusBar />);
    fireEvent.click(screen.getByTestId('status-bar-language'));
    // JavaScript is first in the runnable-language cycle, so the next is
    // TypeScript (the second pack with a runnable execution + templates).
    expect(useEditorStore.getState().tabs[0]?.language).toBe('typescript');
  });

  it('cycles the active model indentation when the indent segment is clicked', () => {
    const editor = makeEditorStub({ insertSpaces: true, tabSize: 2 });
    editorAccessState.editor = editor;
    render(<StatusBar />);
    fireEvent.click(screen.getByTestId('status-bar-indent'));
    // spaces-2 → spaces-4 per the cycle.
    expect(editor.getModel()?.updateOptions).toHaveBeenCalledWith({
      insertSpaces: true,
      tabSize: 4,
    });
  });
});

describe('defaultShowStatusBar', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  });

  it.each(['desktop', 'darwin', 'win32', 'linux'])(
    'returns true when window.lingua.platform is %s',
    (platform) => {
      Object.defineProperty(globalThis, 'window', {
        value: { lingua: { platform } },
        writable: true,
        configurable: true,
      });
      expect(defaultShowStatusBar()).toBe(true);
    }
  );

  it('returns false for the web platform', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { lingua: { platform: 'web' } },
      writable: true,
      configurable: true,
    });
    expect(defaultShowStatusBar()).toBe(false);
  });

  it('returns false when the platform is absent', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      writable: true,
      configurable: true,
    });
    expect(defaultShowStatusBar()).toBe(false);
  });
});

describe('setShowStatusBar', () => {
  const SETTINGS_INITIAL_LOCAL = useSettingsStore.getState();

  afterEach(() => {
    useSettingsStore.setState(SETTINGS_INITIAL_LOCAL, true);
    vi.restoreAllMocks();
  });

  it('flips the showStatusBar flag and emits editor.status_bar_toggled', () => {
    const trackSpy = vi.spyOn(telemetry, 'trackEvent').mockResolvedValue(undefined);
    useSettingsStore.setState({ showStatusBar: false });

    act(() => {
      useSettingsStore.getState().setShowStatusBar(true);
    });

    expect(useSettingsStore.getState().showStatusBar).toBe(true);
    expect(trackSpy).toHaveBeenCalledWith('editor.status_bar_toggled', {
      enabled: true,
    });
  });

  it('does not re-emit telemetry when the value is unchanged', () => {
    const trackSpy = vi.spyOn(telemetry, 'trackEvent').mockResolvedValue(undefined);
    useSettingsStore.setState({ showStatusBar: true });

    act(() => {
      useSettingsStore.getState().setShowStatusBar(true);
    });

    expect(trackSpy).not.toHaveBeenCalled();
  });
});
