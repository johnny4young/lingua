/**
 * Tests for the run capsules browser: rows that answer with their run's
 * numeral, the Pro list (search, result filter, detail pane, Open / Share /
 * Compare / Export / More), imported capsules, the compare pick, the import
 * strip, and the Free gate that opens only the user's own last run.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';

const trackEvent = vi.fn();
vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

let mockEntitled = true;
let mockTier = 'pro';
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({
  useEntitlement: () => mockEntitled,
  useEffectiveTier: () => mockTier,
  // editorStore.addTab (reached via Open) reads this non-hook helper.
  currentEffectiveTier: () => mockTier,
}));

const pushUpsellNotice = vi.fn();
vi.mock('../../../src/renderer/utils/upsellNotice', () => ({
  pushUpsellNotice: (...args: unknown[]) => pushUpsellNotice(...args),
}));

// HTML export is unit-covered in tests/utils/exportCapsuleHtml.test.ts.
const exportCapsuleAsHtml = vi.fn();
vi.mock('../../../src/renderer/utils/exportCapsuleHtml', () => ({
  exportCapsuleAsHtml: (...args: unknown[]) => exportCapsuleAsHtml(...args),
}));

import { CapsuleListOverlay } from '../../../src/renderer/components/CapsuleList';
import {
  useExecutionHistoryStore,
  type ExecutionHistoryEntry,
} from '../../../src/renderer/stores/executionHistoryStore';
import { useImportedCapsuleStore } from '../../../src/renderer/stores/importedCapsuleStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { subscribeCommand, _resetCommandBusForTesting } from '../../../src/renderer/stores/commandBus';
import { _resetCapsuleListSurfaceForTesting } from '../../../src/renderer/components/CapsuleList/capsuleListSurface';
import { takePendingCapsuleImport } from '../../../src/renderer/clipboard/pendingCapsuleImport';
import type { RunCompareRecord } from '@/utils/runCompareRecord';
import type { RunCapsuleV1 } from '../../../src/shared/runCapsule';
import {
  FIXTURE_FULL_TS,
  FIXTURE_MINIMAL_JS,
  FIXTURE_PYTHON_ERROR,
  FIXTURE_STOPPED,
  FIXTURE_TIMEOUT,
} from '../../shared/runCapsule.fixtures';

function entry(id: string, capsule: RunCapsuleV1, timestamp = 1_700_000_000_000): ExecutionHistoryEntry {
  return {
    id,
    language: capsule.tab.language,
    status: capsule.result.status === 'success' ? 'ok' : 'error',
    durationMs: 1,
    timestamp,
    snapshot: null,
    lastCapsule: capsule,
  };
}

function seed(...capsules: RunCapsuleV1[]) {
  useExecutionHistoryStore.setState({
    entries: capsules.map((capsule, index) => entry(`e${index + 1}`, capsule, 1_700_000_000_000 + index * 1000)),
  });
}

const rowNames = () => screen.getAllByTestId('capsule-list-row').map((row) => row.textContent);

function choose(menu: 'capsule-list-share' | 'capsule-list-export' | 'capsule-list-more', item: string) {
  fireEvent.click(screen.getByTestId(menu));
  fireEvent.click(screen.getByTestId(item));
}

/** The action row overflows until its fit step reaches `fitsAt`. */
function mockActionRowFit(fitsAt: number) {
  const state = { fitsAt, restore: () => {} };
  const isRow = (node: HTMLElement) => node.dataset.testid === 'capsule-detail-actions';
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isRow(this) && Number(this.dataset.fit) < state.fitsAt ? 500 : 0;
  });
  const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isRow(this) ? 300 : 0;
  });
  state.restore = () => {
    scroll.mockRestore();
    client.mockRestore();
  };
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEntitled = true;
  mockTier = 'pro';
  _resetCapsuleListSurfaceForTesting();
  _resetCommandBusForTesting();
  useExecutionHistoryStore.setState({ entries: [] });
  useImportedCapsuleStore.setState({ entries: [] });
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useUIStore.setState({ statusNotice: null, statusNoticeQueue: [] });
});

afterEach(async () => {
  await i18next.changeLanguage('en');
});

describe('CapsuleListOverlay — Pro browser', () => {
  it('lists capsules newest first and shows the selected one as code, input and output', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);

    expect(rowNames()[0]).toContain('demo.ts');
    expect(rowNames()[1]).toContain('scratchpad.js');
    expect(screen.getByTestId('capsule-detail-code').textContent).toContain(FIXTURE_FULL_TS.source.content);
    expect(screen.getByTestId('capsule-detail-input').textContent).toBe('Ada\n');
    expect(screen.getByTestId('capsule-detail-output').textContent).toContain('hi Ada');
    expect(screen.getByTestId('capsule-detail-run-details-panel')).toBeTruthy();
  });

  it('answers each row with its time, rows, status line or error name', () => {
    useExecutionHistoryStore.setState({
      entries: [
        { ...entry('e1', FIXTURE_MINIMAL_JS), runNumber: 7 },
        entry('e2', FIXTURE_PYTHON_ERROR, 1_700_000_001_000),
        { ...entry('e3', { ...FIXTURE_FULL_TS, tab: { ...FIXTURE_FULL_TS.tab, name: 'orders', language: 'sql' } }, 1_700_000_002_000), resultSummary: { kind: 'rows', count: 1200, columns: ['city'] } },
        { ...entry('e4', { ...FIXTURE_FULL_TS, tab: { ...FIXTURE_FULL_TS.tab, name: 'GET /missing', language: 'http' } }, 1_700_000_003_000), resultSummary: { kind: 'http', method: 'GET', status: 404, statusText: 'Not Found', bytes: 9 } },
        entry('e5', FIXTURE_STOPPED, 1_700_000_004_000),
      ],
    });
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    const rows = screen.getAllByTestId('capsule-list-row');
    const answerOf = (name: string) => within(rows.find((row) => row.textContent!.includes(name))!).getByTestId('capsule-list-row-answer');
    expect(answerOf('scratchpad.js').textContent).toBe('3.0ms');
    expect(answerOf('orders').textContent).toBe('1,200rows');
    expect(answerOf('GET /missing').textContent).toBe('404not found');
    expect(answerOf('GET /missing').getAttribute('data-tone')).toBe('error');
    expect(answerOf(FIXTURE_PYTHON_ERROR.tab.name).textContent).toBe('ValueError');
    expect(answerOf(FIXTURE_PYTHON_ERROR.tab.name).getAttribute('data-tone')).toBe('error');
    expect(answerOf(FIXTURE_STOPPED.tab.name).getAttribute('data-tone')).toBe('neutral');
    expect(rows.find((row) => row.textContent!.includes('scratchpad.js'))!.textContent).toContain('run 7');
  });

  it('puts the newest own run first under Your last run, ahead of a newer import', () => {
    seed(FIXTURE_MINIMAL_JS);
    useImportedCapsuleStore.getState().add(FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByText('Your last run')).toBeTruthy();
    expect(screen.getAllByTestId('capsule-list-row').map((row) => row.getAttribute('data-kind'))).toEqual(['run', 'imported']);
  });

  it('heads the detail with the run numeral, name and status', () => {
    useExecutionHistoryStore.setState({ entries: [{ ...entry('e1', FIXTURE_STOPPED), runNumber: 3 }] });
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-detail-answer').textContent).toBe('Stopped');
    expect(screen.getByTestId('capsule-detail').textContent).toContain(`${FIXTURE_STOPPED.tab.name} · run 3`);
    // The numeral already says Stopped, so the status line keeps only the language and time.
    expect(screen.getByTestId('capsule-detail-status').textContent).not.toContain('Stopped');
    expect(screen.getByTestId('capsule-detail-status').textContent).toMatch(/^JavaScript · /);
  });

  it('keeps the outcome word on the status line when the numeral is a time', () => {
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-detail-status').textContent).toMatch(/^Success · JavaScript · /);
  });

  it('heads only the newest own run with Your last run and groups the rest as earlier', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS, FIXTURE_PYTHON_ERROR);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    const rows = screen.getByTestId('capsule-list-rows');
    const last = within(rows).getByRole('group', { name: 'Your last run' });
    const earlier = within(rows).getByRole('group', { name: 'Earlier' });
    expect(within(last).getAllByTestId('capsule-list-row')).toHaveLength(1);
    expect(within(earlier).getAllByTestId('capsule-list-row')).toHaveLength(2);
    expect(screen.getAllByText('Your last run')).toHaveLength(1);

    // A filter that hides the last run leaves a flat list without either label.
    fireEvent.click(screen.getByTestId('capsule-list-filter-ok'));
    expect(within(rows).queryByRole('group')).toBeNull();
    expect(within(rows).getAllByTestId('capsule-list-row')).toHaveLength(2);
  });

  it('opens a picked row as its own view and Back returns focus to the list', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    const browser = screen.getByTestId('capsule-list-preview-pane').parentElement!;
    expect(browser.getAttribute('data-view')).toBe('list');
    fireEvent.click(screen.getAllByTestId('capsule-list-row')[1]!);
    expect(browser.getAttribute('data-view')).toBe('detail');
    const back = screen.getByTestId('capsule-detail-back');
    expect(back.textContent).toBe('Back to capsules');
    fireEvent.click(back);
    expect(browser.getAttribute('data-view')).toBe('list');
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-rows'));
    // Arrow keys move the pick without leaving the list.
    fireEvent.keyDown(screen.getByTestId('capsule-list-rows'), { key: 'ArrowDown' });
    expect(browser.getAttribute('data-view')).toBe('list');
  });

  it('shows the definition beside the empty state when nothing is kept', () => {
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-list-preview-pane').parentElement!.getAttribute('data-view')).toBe('empty');
    expect(screen.queryByTestId('capsule-detail-back')).toBeNull();
  });

  it('folds Export, then Compare, into More when the action row runs out of width', () => {
    const fit = mockActionRowFit(1);
    try {
      seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
      const { unmount } = render(<CapsuleListOverlay onClose={vi.fn()} />);
      expect(screen.getByTestId('capsule-detail-actions').getAttribute('data-fit')).toBe('1');
      expect(screen.queryByTestId('capsule-list-export')).toBeNull();
      expect(screen.getByTestId('capsule-compare-button')).toBeTruthy();
      fireEvent.click(screen.getByTestId('capsule-list-more'));
      const menu = screen.getByRole('menu');
      expect(within(menu).getByTestId('capsule-list-row-export-html')).toBeTruthy();
      expect(within(menu).getByTestId('capsule-prepare-regression')).toBeTruthy();
      expect(within(menu).getByTestId('capsule-list-row-delete')).toBeTruthy();
      unmount();

      fit.fitsAt = 2;
      const glyph = render(<CapsuleListOverlay onClose={vi.fn()} />);
      expect(screen.getByTestId('capsule-compare-button').textContent).toBe('');
      expect(screen.getByTestId('capsule-compare-button').getAttribute('aria-label')).toBe('Compare with…');
      glyph.unmount();

      fit.fitsAt = 3;
      render(<CapsuleListOverlay onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('capsule-list-more'));
      fireEvent.click(within(screen.getByRole('menu')).getByTestId('capsule-compare-button'));
      expect(screen.getByTestId('capsule-compare-picking')).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByTestId('capsule-list-rows'));
    } finally {
      fit.restore();
    }
  });

  it('folds long code after eight lines and opens the rest on request', () => {
    const source = Array.from({ length: 27 }, (_, index) => `line ${index + 1}`).join('\n');
    seed({ ...FIXTURE_MINIMAL_JS, source: { ...FIXTURE_MINIMAL_JS.source, content: source } });
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByText('Code · 27 lines')).toBeTruthy();
    expect(screen.getByTestId('capsule-detail-code').textContent).not.toContain('line 9');
    const toggle = screen.getByTestId('capsule-detail-code-toggle');
    expect(toggle.textContent).toContain('19 more lines');
    fireEvent.click(toggle);
    expect(screen.getByTestId('capsule-detail-code').textContent).toContain('line 27');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('hands a file dropped on the import strip to the Import overlay', () => {
    seed(FIXTURE_MINIMAL_JS);
    const openImport = vi.fn();
    subscribeCommand('capsule.openImport', openImport);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    const file = new File(['{}'], 'capsule.json', { type: 'application/json' });
    fireEvent.drop(screen.getByTestId('capsule-list-import-strip'), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(openImport).toHaveBeenCalledTimes(1);
    expect(takePendingCapsuleImport()).toEqual({ file });
    fireEvent.click(screen.getByTestId('capsule-list-import-strip'));
    expect(openImport).toHaveBeenCalledTimes(2);
    expect(takePendingCapsuleImport()).toBeNull();
  });

  it('shows the result and a relative time on each row', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_031_000);
    try {
      seed(FIXTURE_PYTHON_ERROR);
      render(<CapsuleListOverlay onClose={vi.fn()} />);
      const row = screen.getByTestId('capsule-list-row');
      expect(row.textContent).toContain('31 seconds ago');
      expect(within(row).getByTestId('capsule-list-row-result').textContent).toBe('Error');
      expect(within(row).getByTestId('capsule-list-row-answer').textContent).toBe('ValueError');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('fires capsule.browse_opened with surface and tier on mount', () => {
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(trackEvent).toHaveBeenCalledWith('capsule.browse_opened', { surface: 'palette', tier: 'pro' });
  });

  it('renders the empty state when no capsules are retained', () => {
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-list-empty')).toBeTruthy();
    expect(screen.queryByTestId('capsule-list-row')).toBeNull();
  });

  it('searches names and code', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    const search = screen.getByTestId('capsule-list-search');
    fireEvent.change(search, { target: { value: 'prompt()' } });
    expect(rowNames()).toEqual([expect.stringContaining('demo.ts')]);
    fireEvent.change(search, { target: { value: 'SCRATCHPAD' } });
    expect(rowNames()).toEqual([expect.stringContaining('scratchpad.js')]);
    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(screen.getByTestId('capsule-list-filtered-empty')).toBeTruthy();
  });

  it('puts timeouts under Errors and keeps imported capsules under All only', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_PYTHON_ERROR, FIXTURE_TIMEOUT);
    useImportedCapsuleStore.getState().add(FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getAllByTestId('capsule-list-row')).toHaveLength(4);

    fireEvent.click(screen.getByTestId('capsule-list-filter-errors'));
    expect(screen.getAllByTestId('capsule-list-row-result').map((node) => node.getAttribute('data-result'))).toEqual(['timeout', 'error']);
    expect(screen.getByTestId('capsule-list-filter-errors').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('capsule-list-filter-ok'));
    expect(screen.getAllByTestId('capsule-list-row-result').map((node) => node.getAttribute('data-result'))).toEqual(['success']);
  });

  it('lists an imported capsule as imported and not run', () => {
    useImportedCapsuleStore.getState().add(FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    const row = screen.getByTestId('capsule-list-row');
    expect(row.getAttribute('data-kind')).toBe('imported');
    expect(row.textContent).toContain('Imported');
    expect(row.textContent).toContain('Not run');
  });

  it('moves the selection with the arrow keys', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('capsule-detail-code').textContent).toContain(FIXTURE_MINIMAL_JS.source.content);
    fireEvent.keyDown(list, { key: 'Home' });
    expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('says when the recorded output was cut short', () => {
    seed(FIXTURE_MINIMAL_JS, { ...FIXTURE_MINIMAL_JS, capsuleId: 'cut', privacy: { redactionVersion: '1', omittedFields: ['result.stdout'] } });
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-detail-output-truncated').textContent).toBe('truncated');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(screen.queryByTestId('capsule-detail-output-truncated')).toBeNull();
  });

  it('labels a stopped run as Stopped', () => {
    seed(FIXTURE_STOPPED);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-list-row-result').textContent).toBe('Stopped');
  });

  it('leaves the detail pane quiet when nothing matches', () => {
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('capsule-list-search'), { target: { value: 'no such capsule' } });
    expect(screen.getByTestId('capsule-list-preview-empty')).toBeTruthy();
    expect(screen.queryByTestId('capsule-list-row-open')).toBeNull();
  });

  it('moves through a menu with the arrow keys and returns focus to its trigger', () => {
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-list-share'));
    const menu = screen.getByRole('menu');
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-row-export'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-row-copy-summary'));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-row-export'));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-row-copy-summary'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-row-export'));
    fireEvent.click(screen.getByTestId('capsule-list-row-export'));
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-share'));
  });

  it('lists runner, hash, branch and what was left out as run details', () => {
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    const panel = screen.getByTestId('capsule-detail-run-details-panel');
    expect(panel.textContent).toContain('RunnerJavaScript');
    expect(panel.textContent).toContain('RuntimeWeb Worker');
    expect(panel.textContent).toMatch(/Platform(Web|Desktop)/);
    expect(panel.textContent).toMatch(/Size\d+ B/);
    expect(panel.textContent).toContain(`${FIXTURE_MINIMAL_JS.source.contentHash.slice(0, 8)}…`);
    expect(panel.textContent).toContain('Branchnone');
    expect(panel.textContent).toContain('Left outnothing');
  });

  it('opens the capsule in an inert tab and closes', () => {
    seed(FIXTURE_MINIMAL_JS);
    const onClose = vi.fn();
    render(<CapsuleListOverlay onClose={onClose} />);
    fireEvent.click(screen.getByTestId('capsule-list-row-open'));
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('exports from the Share menu with the list trigger', async () => {
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    choose('capsule-list-share', 'capsule-list-row-export');
    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith('capsule.exported', { trigger: 'list-export', sizeBucket: expect.any(String) });
    });
    choose('capsule-list-export', 'capsule-list-row-export-html');
    await waitFor(() => expect(exportCapsuleAsHtml).toHaveBeenCalledTimes(1));
    const [capsule, trigger, context] = exportCapsuleAsHtml.mock.calls[0]! as [RunCapsuleV1, string, { locale: string }];
    expect(capsule.capsuleId).toBe(FIXTURE_MINIMAL_JS.capsuleId);
    expect(trigger).toBe('list-export-html');
    expect(context.locale).toBe('en');
  });

  it('closes an open menu on Escape without closing the dialog', () => {
    seed(FIXTURE_MINIMAL_JS);
    const onClose = vi.fn();
    render(<CapsuleListOverlay onClose={onClose} />);
    fireEvent.click(screen.getByTestId('capsule-list-share'));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens the Capsule Workspace review from the hint', () => {
    seed(FIXTURE_MINIMAL_JS);
    useEditorStore.setState({
      tabs: [{ id: 'helper', name: 'helper.ts', language: 'typescript', content: 'export const n = 1;', isDirty: false }],
      activeTabId: 'helper',
    });
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-list-row-create-workspace'));
    expect(screen.getByTestId('capsule-workspace-export-dialog')).toBeTruthy();
    expect(screen.getByTestId('capsule-workspace-hint').textContent).toContain('Need the files around it?');
  });

  it('removes a run capsule and Undo puts it back', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    choose('capsule-list-more', 'capsule-list-row-delete');
    expect(useExecutionHistoryStore.getState().capsuleEntries()).toHaveLength(1);
    expect(screen.getAllByTestId('capsule-list-row')).toHaveLength(1);

    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('capsuleList.notice.capsuleRemoved');
    notice!.actions![0]!.onClick();
    expect(useExecutionHistoryStore.getState().capsuleEntries().map((item) => item.id)).toEqual(['e2', 'e1']);
  });

  it('removes the run copy kept for Compare runs with the capsule, and Undo restores both', () => {
    seed(FIXTURE_MINIMAL_JS);
    const runCompare = { code: 'secret', stdout: 'body' } as unknown as RunCompareRecord;
    useExecutionHistoryStore.setState((state) => ({ entries: state.entries.map((item) => ({ ...item, runCompare })) }));
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    choose('capsule-list-more', 'capsule-list-row-delete');
    expect(useExecutionHistoryStore.getState().entries[0]?.runCompare).toBeUndefined();
    useUIStore.getState().statusNotice!.actions![0]!.onClick();
    expect(useExecutionHistoryStore.getState().entries[0]?.runCompare).toBe(runCompare);
  });

  it('removes an imported capsule and Undo puts it back', () => {
    useImportedCapsuleStore.getState().add(FIXTURE_MINIMAL_JS);
    useImportedCapsuleStore.getState().add(FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    choose('capsule-list-more', 'capsule-list-row-delete');
    expect(useImportedCapsuleStore.getState().entries.map((item) => item.capsule.capsuleId)).toEqual([FIXTURE_MINIMAL_JS.capsuleId]);

    useUIStore.getState().statusNotice!.actions![0]!.onClick();
    expect(useImportedCapsuleStore.getState().entries.map((item) => item.capsule.capsuleId)).toEqual([
      FIXTURE_MINIMAL_JS.capsuleId,
      FIXTURE_FULL_TS.capsuleId,
    ]);
  });

  it('asks for the Import overlay from the header', () => {
    seed(FIXTURE_MINIMAL_JS);
    const openImport = vi.fn();
    subscribeCommand('capsule.openImport', openImport);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-list-import'));
    expect(openImport).toHaveBeenCalledTimes(1);
  });
});

describe('CapsuleListOverlay — compare', () => {
  it('pairs the selected capsule with the next one picked, older first', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-compare-button'));
    expect(screen.getByTestId('capsule-compare-picking').textContent).toContain('demo.ts');

    fireEvent.click(screen.getAllByTestId('capsule-list-row')[1]!);
    expect(screen.getByTestId('capsule-compare-pane-older').textContent).toBe(FIXTURE_MINIMAL_JS.source.content);
    expect(screen.getByTestId('capsule-compare-pane-newer').textContent).toBe(FIXTURE_FULL_TS.source.content);
    expect(trackEvent).toHaveBeenCalledWith('capsule.compared', { sameLanguage: false });
    expect(screen.queryByTestId('capsule-compare-picking')).toBeNull();
  });

  it('compares from the keyboard: the pick takes focus and Enter chooses the second capsule', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-compare-button'));
    const list = screen.getByRole('listbox');
    expect(document.activeElement).toBe(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(screen.getByTestId('capsule-compare-pane-older').textContent).toBe(FIXTURE_MINIMAL_JS.source.content);
  });

  it('ends the pick when its capsule is removed', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-compare-button'));
    choose('capsule-list-more', 'capsule-list-row-delete');
    expect(screen.queryByTestId('capsule-compare-picking')).toBeNull();
    fireEvent.click(screen.getByTestId('capsule-list-row'));
    expect(screen.queryByTestId('capsule-compare-modal')).toBeNull();
  });

  it('Escape leaves the pick and keeps the dialog open', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    const onClose = vi.fn();
    render(<CapsuleListOverlay onClose={onClose} />);
    fireEvent.click(screen.getByTestId('capsule-compare-button'));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByTestId('capsule-compare-picking')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot compare a lone capsule', () => {
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect((screen.getByTestId('capsule-compare-button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CapsuleListOverlay — Free gate', () => {
  beforeEach(() => {
    mockEntitled = false;
    mockTier = 'free';
  });

  it('opens only the last own run and lists the earlier ones locked below the gate', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS, FIXTURE_PYTHON_ERROR);
    useImportedCapsuleStore.getState().add(FIXTURE_TIMEOUT);
    render(<CapsuleListOverlay onClose={vi.fn()} />);

    expect(screen.getByTestId('capsule-list-upsell').textContent).toContain('2 earlier runs from this session are below.');
    expect(screen.getAllByTestId('capsule-list-row')).toHaveLength(1);
    expect(within(screen.getByTestId('capsule-list-rows')).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByTestId('capsule-list-locked').getAttribute('aria-label')).toBe('Earlier runs, Pro');
    const locked = within(screen.getByTestId('capsule-list-locked')).getAllByTestId('capsule-list-row-locked');
    expect(locked).toHaveLength(2);
    expect(locked[0]!.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(locked[0]!);
    expect(screen.getByTestId('capsule-detail-code').textContent).toContain(FIXTURE_PYTHON_ERROR.source.content);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(screen.getByTestId('capsule-detail-code').textContent).toContain(FIXTURE_PYTHON_ERROR.source.content);
    expect(screen.getByTestId('capsule-list-quota').textContent).toBe('Free · 3 of 5 kept');
    expect(screen.getByTestId('capsule-list-import')).toBeTruthy();
    for (const id of ['capsule-list-row-open', 'capsule-list-share', 'capsule-list-search']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    for (const id of ['capsule-list-more', 'capsule-compare-button', 'capsule-list-export']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(trackEvent).toHaveBeenCalledWith('capsule.browse_opened', { surface: 'palette', tier: 'free' });
  });

  it('keeps an earlier run locked when a search or filter hides the last one', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS, FIXTURE_PYTHON_ERROR);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('capsule-list-search'), { target: { value: FIXTURE_FULL_TS.tab.name } });
    expect(screen.queryByTestId('capsule-list-row')).toBeNull();
    expect(screen.queryByTestId('capsule-detail')).toBeNull();
    expect(screen.queryByText('Your last run')).toBeNull();
    expect(screen.getAllByTestId('capsule-list-row-locked')).toHaveLength(1);
    expect(screen.getByTestId('capsule-list-upsell').textContent).toContain('1 earlier run from this session is below.');
  });

  it('sends Compare, Export and Capsule Workspace to Compare plans', () => {
    const compare = vi.fn();
    subscribeCommand('plans.compare', compare);
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    for (const id of ['capsule-compare-locked', 'capsule-export-locked', 'capsule-list-row-create-workspace']) {
      fireEvent.click(screen.getByTestId(id));
    }
    expect(compare).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId('capsule-workspace-export-dialog')).toBeNull();
  });

  it('folds the locked Export into More with its PRO mark', () => {
    const compare = vi.fn();
    subscribeCommand('plans.compare', compare);
    const fit = mockActionRowFit(1);
    try {
      seed(FIXTURE_MINIMAL_JS);
      render(<CapsuleListOverlay onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('capsule-list-more'));
      const item = within(screen.getByRole('menu')).getByTestId('capsule-export-locked');
      expect(item.textContent).toContain('PRO');
      expect(within(screen.getByRole('menu')).queryByTestId('capsule-list-row-delete')).toBeNull();
      fireEvent.click(item);
      expect(compare).toHaveBeenCalledTimes(1);
    } finally {
      fit.restore();
    }
  });

  it('shows the empty state before the first run', () => {
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-list-empty')).toBeTruthy();
    expect(screen.getByTestId('capsule-list-quota').textContent).toBe('Free · 0 of 5 kept');
  });

  it('swaps the upgrade button for a PRO chip with Pro in context', () => {
    const compare = vi.fn();
    subscribeCommand('plans.compare', compare);
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.queryByTestId('capsule-list-upsell-cta')).toBeNull();
    expect(screen.getByTestId('capsule-detail-code')).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('capsule-list-free-slice')).getByTestId('pro-chip'));
    expect(compare).toHaveBeenCalled();
  });
});

describe('CapsuleListOverlay — ES tuteo', () => {
  it('renders the Spanish title, definition and actions', async () => {
    await i18next.changeLanguage('es');
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Cápsulas de ejecución' })).toBeTruthy();
    expect(screen.getByText(/Una cápsula es una ejecución guardada/)).toBeTruthy();
    expect(screen.getByTestId('capsule-list-row-open').textContent).toBe('Abrir');
    expect(screen.getByTestId('capsule-list-row-result').textContent).toBe('Correcta');
    expect(screen.getByTestId('capsule-detail-back').textContent).toBe('Volver a las cápsulas');
    expect(screen.getByTestId('capsule-detail-run-details-panel').textContent).toMatch(/Plataforma(Web|Escritorio)/);
  });

  it('labels the earlier group in Spanish', async () => {
    await i18next.changeLanguage('es');
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Anteriores' })).toBeTruthy();
  });
});
