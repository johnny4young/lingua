/**
 * RL-043 Slice H — notebook cell-list row virtualization (degrade-to-full).
 *
 * Verifies the windowed cell list under jsdom (where `clientHeight === 0`
 * makes `useListWindow` degrade to the full list) against the REAL hook:
 *
 *   - every cell still renders, so component-level behavior is unchanged;
 *   - the aria-hidden spacer <li>s are absent in degrade mode (both spacers
 *     are 0, so neither is emitted).
 *
 * The `scrollToIndex`-on-navigation seam is asserted in the sibling
 * `NotebookView.scrollToIndex.test.tsx`, which mocks the hook to spy the
 * imperative call (jsdom never produces a non-degrade window to scroll
 * within).
 */

import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
// Cells host Monaco; jsdom needs the mock.
vi.mock('@monaco-editor/react', async () => {
  const m = await import('../../__fixtures__/monacoEditorMock');
  return m.makeMonacoEditorMock();
});

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

const TAB_ID = 'tab-virt';

function seed(cells: NotebookCellV1[], activeCellId = cells[0]?.id ?? null) {
  useNotebookStore.setState({
    notebooks: {
      [TAB_ID]: {
        notebook: {
          version: 1,
          id: 'notebook-virt',
          title: 'Virt',
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

function setupTab() {
  useEditorStore.setState({
    tabs: [
      {
        id: TAB_ID,
        name: 'Virt.linguanb',
        language: 'javascript',
        content: '',
        isDirty: false,
        kind: 'notebook',
      },
    ],
    activeTabId: TAB_ID,
  });
}

describe('<NotebookView /> row virtualization (degrade-to-full)', () => {
  beforeAll(async () => {
    await initI18n();
  });
  beforeEach(async () => {
    resetMonacoCellHarness();
    resetNotebookStoreForTests();
    setupTab();
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

  it('renders every cell when the viewport has no height (jsdom)', () => {
    const cells = Array.from({ length: 30 }, (_, i) => codeCell(`c${i}`));
    seed(cells);
    render(<NotebookView tabId={TAB_ID} />);
    // All 30 rows mount — the windower degraded to the full list.
    expect(screen.getAllByTestId('notebook-code-cell-row')).toHaveLength(30);
    expect(screen.getByTestId('notebook-cells')).toBeTruthy();
  });

  it('omits both spacer <li>s in degrade mode', () => {
    const cells = Array.from({ length: 12 }, (_, i) => codeCell(`c${i}`));
    seed(cells);
    render(<NotebookView tabId={TAB_ID} />);
    const list = screen.getByRole('list');
    // In degrade mode top + bottom spacers are 0 and therefore not emitted,
    // so every <li> is a real cell row, none aria-hidden.
    const items = Array.from(list.querySelectorAll(':scope > li'));
    expect(items).toHaveLength(12);
    expect(items.some((li) => li.getAttribute('aria-hidden') === 'true')).toBe(
      false
    );
  });

  // Reviewer fix (RL-043 Slice H a11y): windowing drops off-screen rows
  // from the DOM, so each mounted row must report the TRUE list size +
  // 1-based position via aria-setsize / aria-posinset, otherwise a screen
  // reader sees only the mounted slice.
  it('tags each row with aria-setsize + aria-posinset for AT', () => {
    const cells = Array.from({ length: 12 }, (_, i) => codeCell(`c${i}`));
    seed(cells);
    render(<NotebookView tabId={TAB_ID} />);
    const items = Array.from(
      screen.getByRole('list').querySelectorAll<HTMLElement>(':scope > li')
    );
    expect(items).toHaveLength(12);
    expect(items[0]?.getAttribute('aria-setsize')).toBe('12');
    expect(items[0]?.getAttribute('aria-posinset')).toBe('1');
    expect(items[11]?.getAttribute('aria-setsize')).toBe('12');
    expect(items[11]?.getAttribute('aria-posinset')).toBe('12');
  });
});
