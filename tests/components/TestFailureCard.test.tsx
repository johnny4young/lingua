import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import type * as monacoTypes from 'monaco-editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestFailureCard } from '../../src/renderer/components/ProjectTests/TestFailureCard';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useProjectTestStore } from '../../src/renderer/stores/projectTestStore';
import { asRootId } from '../../src/shared/fs/brandedIds';

const initialEditor = useEditorStore.getState();
const initialTests = useProjectTestStore.getState();

function fakeEditor() {
  const zones: Array<{ afterLineNumber: number; heightInPx: number }> = [];
  const widgets: monacoTypes.editor.IContentWidget[] = [];
  let keyListener: ((event: { browserEvent: KeyboardEvent }) => void) | null = null;
  const disposable = { dispose: vi.fn() };
  const editor = {
    getModel: () => ({ getLineCount: () => 20 }),
    changeViewZones: (callback: (accessor: { addZone: (zone: never) => string; removeZone: (id: string) => void }) => void) =>
      callback({
        addZone: zone => {
          zones.push(zone);
          return String(zones.length);
        },
        removeZone: vi.fn(),
      }),
    createDecorationsCollection: vi.fn(() => ({ clear: vi.fn(), getRange: () => null })),
    addContentWidget: (widget: monacoTypes.editor.IContentWidget) => {
      widgets.push(widget);
      document.body.appendChild(widget.getDomNode());
    },
    removeContentWidget: (widget: monacoTypes.editor.IContentWidget) => widget.getDomNode().remove(),
    layoutContentWidget: vi.fn(),
    onDidChangeModelContent: () => disposable,
    onDidLayoutChange: () => disposable,
    getLayoutInfo: () => ({ contentWidth: 900 }),
    onKeyDown: (listener: typeof keyListener) => {
      keyListener = listener;
      return disposable;
    },
  };
  const monaco = {
    Range: class {
      constructor(public startLineNumber: number) {}
    },
    editor: { ContentWidgetPositionPreference: { BELOW: 2, EXACT: 0 } },
  };
  return {
    editor: editor as unknown as monacoTypes.editor.IStandaloneCodeEditor,
    monaco: monaco as unknown as typeof monacoTypes,
    zones,
    widgets,
    pressEscape: () => keyListener?.({ browserEvent: new KeyboardEvent('keydown', { key: 'Escape' }) }),
  };
}

function seed(overrides: { tabFile?: string; stale?: true; message?: string } = {}) {
  useEditorStore.setState({
    tabs: [{ id: 'tab', name: 'total.test.ts', language: 'typescript', content: '', isDirty: false, rootId: 'root-1', relativePath: overrides.tabFile ?? 'cart/total.test.ts' }],
    activeTabId: 'tab',
  });
  useProjectTestStore.setState({
    rootId: asRootId('root-1'),
    projectName: 'checkout',
    status: 'ready',
    selectedFramework: 'vitest',
    focusedFailure: { file: 'cart/total.test.ts', path: ['cartTotal', 'rounds cents'] },
    cases: [
      {
        file: 'cart/total.test.ts',
        path: ['cartTotal', 'rounds cents'],
        status: 'failed',
        failureFile: 'cart/total.test.ts',
        failureLine: 10,
        failureMessage: overrides.message ?? 'AssertionError: expected 1211 to be 1210.5 // Object.is equality',
        ...(overrides.stale ? { stale: true as const } : {}),
      },
    ],
  });
}

describe('TestFailureCard', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useEditorStore.setState(initialEditor, true);
    useProjectTestStore.setState(initialTests, true);
  });

  it('reserves a row under the assertion and shows expected against received', () => {
    seed();
    const fake = fakeEditor();
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} />);
    expect(fake.zones.map(zone => zone.afterLineNumber)).toEqual([10]);
    expect(fake.widgets).toHaveLength(1);
    expect(screen.getByText('This test failed')).toBeTruthy();
    expect(screen.getByTestId('test-failure-summary').textContent).toBe('expected 1210.5 but got 1211');
  });

  it('shows the headline when the runner gives no comparison', () => {
    seed({ message: 'total_test.go:15: two failed' });
    const fake = fakeEditor();
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} />);
    expect(screen.getByTestId('test-failure-summary').textContent).toBe('two failed');
  });

  it('stays away from other files and from results that are only history', () => {
    seed({ tabFile: 'cart/total.ts' });
    const other = fakeEditor();
    const { unmount } = render(<TestFailureCard editor={other.editor} monaco={other.monaco} />);
    expect(screen.queryByTestId('test-failure-card')).toBeNull();
    expect(other.zones).toHaveLength(0);
    unmount();

    seed({ stale: true });
    const stale = fakeEditor();
    render(<TestFailureCard editor={stale.editor} monaco={stale.monaco} />);
    expect(screen.queryByTestId('test-failure-card')).toBeNull();
  });

  it('runs the test again and closes on Close or Escape', async () => {
    seed();
    const run = vi.fn().mockResolvedValue(undefined);
    useProjectTestStore.setState({ run });
    const fake = fakeEditor();
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('test-failure-run-again'));
    expect(run).toHaveBeenCalledWith(
      { rootId: 'root-1', projectName: 'checkout' },
      { kind: 'test', file: 'cart/total.test.ts', path: ['cartTotal', 'rounds cents'] }
    );

    act(() => fake.pressEscape());
    expect(useProjectTestStore.getState().focusedFailure).toBeNull();

    seed();
    await user.click(await screen.findByTestId('test-failure-close'));
    expect(useProjectTestStore.getState().focusedFailure).toBeNull();
  });
});
