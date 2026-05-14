import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultPanel } from '../../src/renderer/components/Editor/ResultPanel';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

const editorState = {
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

  it('lets users reveal undefined expression results on demand', async () => {
    const user = userEvent.setup();

    useResultStore.setState({
      lineResults: [{ line: 2, value: 'undefined', type: 'result' }],
      error: null,
      fullOutput: '',
      executionTime: 3,
      isAutoRunning: false,
      executionSource: 'auto',
    });
    useSettingsStore.setState({ hideUndefined: true });

    render(<ResultPanel />);

    expect(screen.getByTitle('Show undefined values')).toBeTruthy();
    expect(screen.getAllByText('undefined')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'undefined' }));

    expect(screen.getByTitle('Hide undefined values')).toBeTruthy();
    expect(screen.getAllByText('undefined')).toHaveLength(2);
  });

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

  describe('RL-020 Slice 3 — @watch rendering', () => {
    it('renders a pinned watch with the watch test-id and the value', () => {
      useResultStore.setState({
        lineResults: [{ line: 2, value: '42', type: 'watch' }],
        error: null,
        fullOutput: '',
        executionTime: 5,
        isAutoRunning: false,
        executionSource: 'auto',
      });

      render(<ResultPanel />);

      const pill = document.querySelector('[data-result-kind="watch"]');
      expect(pill).not.toBeNull();
      expect(pill?.textContent).toContain('42');
      // Fold F — the watched value lives in an aria-live="polite"
      // region so screen readers announce updates.
      expect(pill?.querySelector('[aria-live="polite"]')?.textContent).toBe(
        '42'
      );
    });

    it('falls back to the empty copy when the watched value is undefined (fold G)', () => {
      useResultStore.setState({
        lineResults: [{ line: 2, value: 'undefined', type: 'watch' }],
        error: null,
        fullOutput: '',
        executionTime: 5,
        isAutoRunning: false,
        executionSource: 'auto',
      });
      useSettingsStore.setState({ hideUndefined: true });

      render(<ResultPanel />);

      // Arrow `undefined` would be filtered; watch `undefined` stays
      // visible with the empty-copy placeholder.
      const pill = document.querySelector('[data-result-kind="watch"]');
      expect(pill).not.toBeNull();
      expect(pill?.textContent).toMatch(/no value yet/);
    });
  });
});
