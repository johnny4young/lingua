/**
 * implementation — programmatic scroll-into-view (the focus-after-scroll
 * seam). The active cell hosts the live editor, and a windowed off-screen
 * row is unmounted, so command-mode navigation MUST scroll the target into
 * the window before focus is attempted. jsdom never produces a non-degrade
 * window, so this mocks `useListWindow` at its module boundary to return a
 * full window plus a spied `scrollToIndex`, then asserts j/k navigation and
 * run-all drive the imperative scroll.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const scrollToIndex = vi.fn();

vi.mock('../../../src/renderer/runners', () => ({
  runnerManager: {
    execute: vi.fn(),
    stop: vi.fn(),
    needsInitialization: vi.fn(() => false),
  },
}));
vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn(),
}));
vi.mock('@monaco-editor/react', async () => {
  const m = await import('../../__fixtures__/monacoEditorMock');
  return m.makeMonacoEditorMock();
});
// Spy the windower: return a degrade-shaped (full) window so every row
// mounts, plus the shared `scrollToIndex` spy the assertions read.
vi.mock('../../../src/renderer/hooks/useListWindow', () => ({
  useListWindow: ({ keys }: { keys: readonly string[] }) => ({
    listWindow: {
      startIndex: 0,
      endIndex: keys.length - 1,
      topSpacer: 0,
      bottomSpacer: 0,
    },
    measureRef: () => () => {},
    scrollToBottom: () => {},
    scrollToIndex,
  }),
}));

import { initI18n } from '../../../src/renderer/i18n';
import { NotebookView } from '../../../src/renderer/components/Notebook/NotebookView';
import {
  resetNotebookStoreForTests,
  useNotebookStore,
} from '../../../src/renderer/stores/notebookStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import type { NotebookCellV1 } from '../../../src/shared/notebook';
import { resetMonacoCellHarness } from '../../__fixtures__/monacoEditorMock';

const TAB_ID = 'tab-scroll';

function seed(cells: NotebookCellV1[], activeCellId = cells[0]?.id ?? null) {
  useNotebookStore.setState({
    notebooks: {
      [TAB_ID]: {
        notebook: {
          version: 1,
          id: 'notebook-scroll',
          title: 'Scroll',
          createdAt: '2026-05-27T00:00:00.000Z',
          cells,
        },
        cellRunStatus: {},
        cellDurationMs: {},
        cellVarFlow: {},
        executionCounter: 0,
        cellExecutionOrder: {},
        lastDeleted: null,
        activeCellId,
      },
    },
    notebookScrollTop: {},
  });
}

function codeCell(id: string, source = ''): NotebookCellV1 {
  return { kind: 'code', id, language: 'javascript', source, outputs: [] };
}

describe('<NotebookView /> scrollToIndex on command-mode nav', () => {
  beforeAll(async () => {
    await initI18n();
  });
  beforeEach(async () => {
    scrollToIndex.mockClear();
    resetMonacoCellHarness();
    resetNotebookStoreForTests();
    useEditorStore.setState({
      tabs: [
        {
          id: TAB_ID,
          name: 'Scroll.linguanb',
          language: 'javascript',
          content: '',
          isDirty: false,
          kind: 'notebook',
        },
      ],
      activeTabId: TAB_ID,
    });
    localStorage.clear();
    useUIStore.setState({ statusNotice: null });
    await i18next.changeLanguage('en');
  });
  afterEach(async () => {
    resetNotebookStoreForTests();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useUIStore.setState({ statusNotice: null });
    localStorage.clear();
    await i18next.changeLanguage('en');
  });

  it('scrolls the target cell into view when j navigates down', () => {
    seed([codeCell('c0'), codeCell('c1'), codeCell('c2')], 'c0');
    render(<NotebookView tabId={TAB_ID} />);
    scrollToIndex.mockClear();
    fireEvent.keyDown(screen.getByTestId('notebook-cells'), { key: 'j' });
    // j moves active c0 -> c1 (index 1); the view scrolls index 1 into view.
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c1');
    expect(scrollToIndex).toHaveBeenCalledWith(1);
  });

  it('scrolls the first code cell into view on Run all (implementation note)', () => {
    seed([codeCell('c0'), codeCell('c1')], 'c0');
    render(<NotebookView tabId={TAB_ID} />);
    scrollToIndex.mockClear();
    fireEvent.click(screen.getByTestId('notebook-toolbar-run-all'));
    expect(scrollToIndex).toHaveBeenCalledWith(0);
  });
});
