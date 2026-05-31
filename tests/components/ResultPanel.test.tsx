import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultPanel } from '../../src/renderer/components/Editor/ResultPanel';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

const editorState: {
  tabs: Array<{
    id: string;
    name: string;
    language: string;
    content: string;
    isDirty: boolean;
    runtimeMode?: 'worker' | 'node' | 'browser-preview';
    variableInspectorEnabled?: boolean;
  }>;
  activeTabId: string | null;
} = {
  tabs: [
    {
      id: 'tab-ts',
      name: 'main.ts',
      language: 'typescript',
      content: 'console.log("hello")\nvalue',
      isDirty: false,
    },
  ],
  activeTabId: 'tab-ts',
};

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: unknown) => unknown) => {
    const state = editorState;

    return selector ? selector(state) : state;
  },
  getActiveTab: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.tabs.find((t) => t.id === s.activeTabId) ?? null,
  getActiveTabIndex: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.activeTabId == null ? -1 : s.tabs.findIndex((t) => t.id === s.activeTabId),
}));

// RL-020 Slice 4 — RecentRunsPill transitively imports useRunner →
// executeTabManually → esbuild-wasm, which fails to initialize under
// the jsdom test environment. The ResultPanel test doesn't exercise
// the pill's behavior (the pill has its own dedicated tests); mock
// it to a no-op render so the rest of the panel still mounts.
vi.mock('../../src/renderer/components/Editor/RecentRunsPill', () => ({
  RecentRunsPill: () => null,
}));

describe('ResultPanel', () => {
  const initialResultState = useResultStore.getState();
  const initialSettingsState = useSettingsStore.getState();

  beforeEach(() => {
    useResultStore.setState(initialResultState, true);
    useSettingsStore.setState(initialSettingsState, true);
    editorState.tabs = [
      {
        id: 'tab-ts',
        name: 'main.ts',
        language: 'typescript',
        content: 'console.log("hello")\nvalue',
        isDirty: false,
      },
    ];
    editorState.activeTabId = 'tab-ts';
  });

  it('does not show the undefined toggle when there is no undefined result to filter', () => {
    useResultStore.setState({
      lineResults: [{ line: 1, value: 'hello', type: 'log' }],
      error: null,
      fullOutput: '',
      executionTime: 12,
      isAutoRunning: false,
      executionSource: 'auto',
    });

    render(<ResultPanel />);

    expect(screen.queryByRole('button', { name: 'undefined' })).toBeNull();
  });

  // Slice 2 — `hideUndefined` was removed (baseline ON, no escape
  // hatch). The "reveal undefined on demand" button no longer
  // renders; `undefined` rows are always filtered from inline
  // results.

  it('shows diagnostics-oriented copy for validate-only files', () => {
    editorState.tabs = [
      {
        id: 'tab-json',
        name: 'package.json',
        language: 'json',
        content: '{ "name": "lingua" }',
        isDirty: false,
      },
    ];
    editorState.activeTabId = 'tab-json';
    useResultStore.setState({
      lineResults: [],
      diagnostics: [],
      error: null,
      fullOutput: 'JSON validation passed. No syntax issues found.',
      executionTime: 4,
      isAutoRunning: false,
      executionSource: 'auto',
    });

    render(<ResultPanel />);

    expect(screen.getByText('Diagnostics')).toBeTruthy();
    expect(screen.getByText('Validation only, never executed')).toBeTruthy();
  });

  it('shows view-only copy for editable formats without run or lint support', () => {
    editorState.tabs = [
      {
        id: 'tab-toml',
        name: 'Cargo.toml',
        language: 'toml',
        content: 'name = "lingua"',
        isDirty: false,
      },
    ];
    editorState.activeTabId = 'tab-toml';
    useResultStore.setState({
      lineResults: [],
      diagnostics: [],
      error: null,
      fullOutput: '',
      executionTime: null,
      isAutoRunning: false,
      executionSource: null,
    });

    render(<ResultPanel />);

    expect(screen.getByText('File Status')).toBeTruthy();
    expect(screen.getByText('Editable without run or lint support')).toBeTruthy();
  });

  it('announces the auto-run gate notice as polite status text', () => {
    useResultStore.setState({
      lineResults: [{ line: 1, value: 'hello', type: 'log' }],
      error: null,
      fullOutput: '',
      executionTime: 12,
      isAutoRunning: false,
      executionSource: 'auto',
      autoRunGateReason: 'incomplete',
    });

    render(<ResultPanel />);

    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/live updates paused/i);
    expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(notice.getAttribute('data-gate-variant')).toBe('default');
  });

  /*
   * RL-093 Slice 3 — the inline result body that mirrored
   * @watch / autoLog / undefined entries was removed from the
   * result panel; those values now render inside the editor via
   * Monaco overlay widgets driven by `useInlineResultWidgets`.
   * The tests that asserted on `data-result-kind` markers in the
   * result panel DOM were deleted alongside the rendering path. The
   * underlying behaviour (line results making it from the runner
   * into the displayed value) is covered by:
   *   - tests/runners/* — runner emits the right LineResult shape
   *   - tests/hooks/runnerOutput.test.ts — output reducer
   *   - the manual web smoke pass per RL-093 Slice 3 verification
   */

  describe('RL-019 Slice 2 — Node runtime exclusions', () => {
    it('hides the variable inspector toggle in Node mode even when a stale worker snapshot exists', () => {
      editorState.tabs = [
        {
          id: 'tab-node',
          name: 'main.ts',
          language: 'typescript',
          content: 'const value: number = 1',
          isDirty: false,
          runtimeMode: 'node',
        },
      ];
      editorState.activeTabId = 'tab-node';
      useResultStore.setState({
        lineResults: [],
        error: null,
        fullOutput: '',
        executionTime: 5,
        isAutoRunning: false,
        executionSource: 'manual',
        scopeSnapshot: {
          language: 'typescript',
          capturedAt: 100,
          variables: [
            {
              name: 'value',
              value: {
                kind: 'primitive',
                type: 'number',
                repr: '1',
              },
            },
          ],
        },
      });

      render(<ResultPanel />);

      expect(screen.queryByTestId('variable-inspector-toggle')).toBeNull();
    });
  });
});
