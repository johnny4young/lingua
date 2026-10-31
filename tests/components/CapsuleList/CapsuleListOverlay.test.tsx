/**
 * Tests for the run capsules browser: the Pro list (search, result filter,
 * detail pane, Open / Share / More), imported capsules, the compare pick,
 * and the Free gate that previews the user's own last run.
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

function choose(menu: 'capsule-list-share' | 'capsule-list-more', item: string) {
  fireEvent.click(screen.getByTestId(menu));
  fireEvent.click(screen.getByTestId(item));
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
    expect(screen.queryByTestId('capsule-detail-run-details-panel')).toBeNull();
  });

  it('shows the result and a relative time on each row', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_031_000);
    try {
      seed(FIXTURE_PYTHON_ERROR);
      render(<CapsuleListOverlay onClose={vi.fn()} />);
      const row = screen.getByTestId('capsule-list-row');
      expect(row.textContent).toContain('31 seconds ago');
      expect(within(row).getByTestId('capsule-list-row-result').textContent).toBe('Error');
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
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-row-export-html'));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-row-copy-summary'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-row-export'));
    fireEvent.click(screen.getByTestId('capsule-list-row-export'));
    expect(document.activeElement).toBe(screen.getByTestId('capsule-list-share'));
  });

  it('folds runner and hash under Run details', () => {
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-detail-run-details'));
    const panel = screen.getByTestId('capsule-detail-run-details-panel');
    expect(panel.textContent).toContain(FIXTURE_MINIMAL_JS.environment.runner);
    expect(panel.textContent).toContain(FIXTURE_MINIMAL_JS.source.contentHash.slice(0, 12));
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
    choose('capsule-list-share', 'capsule-list-row-export-html');
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

  it('opens the Capsule Workspace review from More', () => {
    seed(FIXTURE_MINIMAL_JS);
    useEditorStore.setState({
      tabs: [{ id: 'helper', name: 'helper.ts', language: 'typescript', content: 'export const n = 1;', isDirty: false }],
      activeTabId: 'helper',
    });
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    choose('capsule-list-more', 'capsule-list-row-create-workspace');
    expect(screen.getByTestId('capsule-workspace-export-dialog')).toBeTruthy();
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
    choose('capsule-list-more', 'capsule-compare-button');
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
    choose('capsule-list-more', 'capsule-compare-button');
    const list = screen.getByRole('listbox');
    expect(document.activeElement).toBe(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(screen.getByTestId('capsule-compare-pane-older').textContent).toBe(FIXTURE_MINIMAL_JS.source.content);
  });

  it('ends the pick when its capsule is removed', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    choose('capsule-list-more', 'capsule-compare-button');
    choose('capsule-list-more', 'capsule-list-row-delete');
    expect(screen.queryByTestId('capsule-compare-picking')).toBeNull();
    fireEvent.click(screen.getByTestId('capsule-list-row'));
    expect(screen.queryByTestId('capsule-compare-modal')).toBeNull();
  });

  it('Escape leaves the pick and keeps the dialog open', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS);
    const onClose = vi.fn();
    render(<CapsuleListOverlay onClose={onClose} />);
    choose('capsule-list-more', 'capsule-compare-button');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByTestId('capsule-compare-picking')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot compare a lone capsule', () => {
    seed(FIXTURE_MINIMAL_JS);
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-list-more'));
    expect((screen.getByTestId('capsule-compare-button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CapsuleListOverlay — Free gate', () => {
  beforeEach(() => {
    mockEntitled = false;
    mockTier = 'free';
  });

  it('previews the last own run read-only with the quota and Import', () => {
    seed(FIXTURE_MINIMAL_JS, FIXTURE_FULL_TS, FIXTURE_PYTHON_ERROR);
    useImportedCapsuleStore.getState().add(FIXTURE_TIMEOUT);
    render(<CapsuleListOverlay onClose={vi.fn()} />);

    expect(screen.getByTestId('capsule-list-upsell')).toBeTruthy();
    expect(screen.getAllByTestId('capsule-list-row')).toHaveLength(1);
    expect(screen.getByTestId('capsule-detail-code').textContent).toContain(FIXTURE_PYTHON_ERROR.source.content);
    expect(screen.getByTestId('capsule-list-quota').textContent).toBe('Free · 3 of 5 kept');
    expect(screen.getByTestId('capsule-list-import')).toBeTruthy();
    for (const id of ['capsule-list-row-open', 'capsule-list-share', 'capsule-list-more', 'capsule-list-search']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(trackEvent).toHaveBeenCalledWith('capsule.browse_opened', { surface: 'palette', tier: 'free' });
  });

  it('shows the empty state before the first run', () => {
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-list-empty')).toBeTruthy();
    expect(screen.getByTestId('capsule-list-quota').textContent).toBe('Free · 0 of 5 kept');
  });

  it('the upgrade CTA pushes the upsell notice and feature.blocked', () => {
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-list-upsell-cta'));
    expect(pushUpsellNotice).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('feature.blocked', { entitlement: 'execution-history', tier: 'free' });
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
  });
});
