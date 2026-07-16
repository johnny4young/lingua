/**
 * RL-094 Slice 3 — tests for the capsule browse overlay.
 *
 * Covers the Pro list (rows + count + preview + browse_opened
 * telemetry), the per-row actions (export → list-export telemetry,
 * delete → store mutation), the status filter (fold C), the Free-tier
 * upsell variant (fold G funnel still fires browse_opened), and ES
 * tuteo copy.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  // editorStore.addTab (reached via the open-in-tab action) reads this
  // non-hook tier helper from the same module — provide it so the mock
  // is complete.
  currentEffectiveTier: () => mockTier,
}));

const pushUpsellNotice = vi.fn();
vi.mock('../../../src/renderer/utils/upsellNotice', () => ({
  pushUpsellNotice: (...args: unknown[]) => pushUpsellNotice(...args),
}));

// IT2-F7 — HTML export orchestration is unit-covered in
// `tests/utils/exportCapsuleHtml.test.ts`; the overlay only needs to
// wire the row's capsule + list trigger into it.
const exportCapsuleAsHtml = vi.fn();
vi.mock('../../../src/renderer/utils/exportCapsuleHtml', () => ({
  exportCapsuleAsHtml: (...args: unknown[]) => exportCapsuleAsHtml(...args),
}));

import { CapsuleListOverlay } from '../../../src/renderer/components/CapsuleList';
import {
  useExecutionHistoryStore,
  type ExecutionHistoryEntry,
} from '../../../src/renderer/stores/executionHistoryStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { _resetCapsuleListSurfaceForTesting } from '../../../src/renderer/components/CapsuleList/capsuleListSurface';
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_FULL_TS,
} from '../../shared/runCapsule.fixtures';

function entry(
  id: string,
  language: string,
  status: 'ok' | 'error',
  capsule: ExecutionHistoryEntry['lastCapsule']
): ExecutionHistoryEntry {
  return {
    id,
    language,
    status,
    durationMs: 1,
    timestamp: 1_700_000_000_000,
    snapshot: null,
    lastCapsule: capsule,
  };
}

function seedTwoCapsules() {
  useExecutionHistoryStore.setState({
    entries: [
      entry('e1', 'javascript', 'ok', FIXTURE_MINIMAL_JS),
      entry('e2', 'typescript', 'error', FIXTURE_FULL_TS),
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEntitled = true;
  mockTier = 'pro';
  _resetCapsuleListSurfaceForTesting();
  useExecutionHistoryStore.setState({ entries: [] });
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

afterEach(async () => {
  await i18next.changeLanguage('en');
});

describe('CapsuleListOverlay — Pro tier', () => {
  it('renders a row per retained capsule with a count chip + preview', () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);

    expect(screen.getByTestId('capsule-list-overlay')).not.toBeNull();
    expect(screen.getAllByTestId('capsule-list-row')).toHaveLength(2);
    expect(screen.getByTestId('capsule-list-count').textContent).toContain('2');
    // The preview pane auto-selects the newest capsule.
    expect(screen.getByTestId('capsule-list-preview-pane')).not.toBeNull();
    expect(screen.getByTestId('capsule-import-preview')).not.toBeNull();
  });

  it('renders relative timestamps for retained capsules', () => {
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(1_700_000_030_000);
    try {
      seedTwoCapsules();
      render(<CapsuleListOverlay onClose={vi.fn()} />);
      expect(screen.getAllByText('30 seconds ago')).toHaveLength(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('fires capsule.browse_opened with surface + tier on mount (fold G)', () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(trackEvent).toHaveBeenCalledWith('capsule.browse_opened', {
      surface: 'palette',
      tier: 'pro',
    });
  });

  it('renders the empty state when no capsules are retained', () => {
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-list-empty')).not.toBeNull();
    expect(screen.queryByTestId('capsule-list-row')).toBeNull();
  });

  it('exports a row with the list-export trigger (fold)', async () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByTestId('capsule-list-row-export')[0]!);
    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith('capsule.exported', {
        trigger: 'list-export',
        sizeBucket: expect.any(String),
      });
    });
  });

  it('exports a row as HTML with the list trigger (IT2-F7)', async () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByTestId('capsule-list-row-export-html')[0]!);
    await waitFor(() => {
      expect(exportCapsuleAsHtml).toHaveBeenCalledTimes(1);
    });
    const [capsule, trigger, context] = exportCapsuleAsHtml.mock.calls[0]! as [
      { version: number },
      string,
      { locale: string },
    ];
    expect(capsule.version).toBe(1);
    expect(trigger).toBe('list-export-html');
    expect(context.locale).toBe('en');
  });

  it('deletes a row capsule via clearCapsule (fold B)', () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getAllByTestId('capsule-list-row')).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId('capsule-list-row-delete')[0]!);
    // The newest (typescript) capsule is dropped; one row remains.
    expect(
      useExecutionHistoryStore.getState().capsuleEntries()
    ).toHaveLength(1);
    expect(screen.getAllByTestId('capsule-list-row')).toHaveLength(1);
  });

  it('delete offers an Undo that restores the capsule (fold E)', () => {
    useUIStore.setState({ statusNotice: null });
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);

    // Newest first → row 0 is the typescript entry (e2).
    fireEvent.click(screen.getAllByTestId('capsule-list-row-delete')[0]!);
    expect(
      useExecutionHistoryStore.getState().capsuleEntries()
    ).toHaveLength(1);

    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('capsuleList.notice.capsuleRemoved');
    const undo = notice?.actions?.find((a) => a.labelKey === 'common.undo');
    expect(undo).toBeTruthy();

    // Undo re-attaches the capsule to the same run row (e2), restoring
    // it to the browse list at its prior position (newest first).
    undo!.onClick();
    const restored = useExecutionHistoryStore.getState().capsuleEntries();
    expect(restored).toHaveLength(2);
    expect(restored[0]!.id).toBe('e2');

    // A second undo is a no-op (the row already has a capsule again).
    undo!.onClick();
    expect(
      useExecutionHistoryStore.getState().capsuleEntries()
    ).toHaveLength(2);
  });

  it('opens a capsule source in a new tab and closes (explicit, no replay)', () => {
    seedTwoCapsules();
    const onClose = vi.fn();
    render(<CapsuleListOverlay onClose={onClose} />);
    fireEvent.click(screen.getAllByTestId('capsule-list-row-open')[0]!);
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('filters rows by status (fold C)', () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-list-filter-status-error'));
    expect(screen.getAllByTestId('capsule-list-row')).toHaveLength(1);
  });
});

describe('CapsuleListOverlay — compare selection (RL-094 Slice 4)', () => {
  it('gates the Compare button until exactly two capsules are selected', () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);

    const compareButton = screen.getByTestId(
      'capsule-compare-button'
    ) as HTMLButtonElement;
    // 0 selected → disabled.
    expect(compareButton.disabled).toBe(true);

    // 1 selected → still disabled.
    fireEvent.click(screen.getByTestId('capsule-row-select-e1'));
    expect(compareButton.disabled).toBe(true);

    // 2 selected → enabled.
    fireEvent.click(screen.getByTestId('capsule-row-select-e2'));
    expect(compareButton.disabled).toBe(false);

    // Toggling a (third) selection off drops back below two → disabled.
    fireEvent.click(screen.getByTestId('capsule-row-select-e2'));
    expect(compareButton.disabled).toBe(true);
  });

  it('opens the comparator with the pair sorted oldest → newest and fires telemetry', () => {
    // e1 (javascript) is older, e2 (typescript) is newer by timestamp.
    useExecutionHistoryStore.setState({
      entries: [
        { ...entry('e1', 'javascript', 'ok', FIXTURE_MINIMAL_JS), timestamp: 1_000 },
        { ...entry('e2', 'typescript', 'error', FIXTURE_FULL_TS), timestamp: 2_000 },
      ],
    });
    render(<CapsuleListOverlay onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('capsule-row-select-e1'));
    fireEvent.click(screen.getByTestId('capsule-row-select-e2'));
    fireEvent.click(screen.getByTestId('capsule-compare-button'));

    // Modal opens.
    expect(screen.getByTestId('capsule-compare-modal')).not.toBeNull();
    // Older pane = the javascript (older) capsule's source.
    expect(screen.getByTestId('capsule-compare-pane-older').textContent).toBe(
      FIXTURE_MINIMAL_JS.source.content
    );
    expect(screen.getByTestId('capsule-compare-pane-newer').textContent).toBe(
      FIXTURE_FULL_TS.source.content
    );
    // Cross-language pair → sameLanguage false.
    expect(trackEvent).toHaveBeenCalledWith('capsule.compared', {
      sameLanguage: false,
    });
  });

  it('fires capsule.compared with sameLanguage true for a same-language pair', () => {
    useExecutionHistoryStore.setState({
      entries: [
        { ...entry('e1', 'javascript', 'ok', FIXTURE_MINIMAL_JS), timestamp: 1_000 },
        {
          ...entry('e2', 'javascript', 'ok', {
            ...FIXTURE_MINIMAL_JS,
            capsuleId: '00000000-0000-4000-8000-0000000000aa',
            source: { content: 'console.log(99);', contentHash: 'h2' },
          }),
          timestamp: 2_000,
        },
      ],
    });
    render(<CapsuleListOverlay onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('capsule-row-select-e1'));
    fireEvent.click(screen.getByTestId('capsule-row-select-e2'));
    fireEvent.click(screen.getByTestId('capsule-compare-button'));

    expect(trackEvent).toHaveBeenCalledWith('capsule.compared', {
      sameLanguage: true,
    });
  });

  it('clears the selection when a filter changes (no stale cross-filter pair)', () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('capsule-row-select-e1'));
    fireEvent.click(screen.getByTestId('capsule-row-select-e2'));
    expect(
      (screen.getByTestId('capsule-compare-button') as HTMLButtonElement).disabled
    ).toBe(false);

    // Switching to a status filter clears the selection.
    fireEvent.click(screen.getByTestId('capsule-list-filter-status-error'));
    // Only the error (typescript e2) row is visible now, and its checkbox
    // is back to unchecked.
    const e2checkbox = screen.getByTestId('capsule-row-select-e2') as HTMLInputElement;
    expect(e2checkbox.checked).toBe(false);
    expect(
      (screen.getByTestId('capsule-compare-button') as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe('CapsuleListOverlay — Free tier hides compare UI (RL-094 Slice 4)', () => {
  beforeEach(() => {
    mockEntitled = false;
    mockTier = 'free';
  });

  it('renders no per-row select checkbox and no Compare button', () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-list-upsell')).not.toBeNull();
    expect(screen.queryByTestId('capsule-row-select-e1')).toBeNull();
    expect(screen.queryByTestId('capsule-compare-button')).toBeNull();
  });
});

describe('CapsuleListOverlay — Free tier upsell (fold G)', () => {
  beforeEach(() => {
    mockEntitled = false;
    mockTier = 'free';
  });

  it('renders the upsell variant instead of the list and still fires browse_opened', () => {
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('capsule-list-upsell')).not.toBeNull();
    expect(screen.queryByTestId('capsule-list-row')).toBeNull();
    expect(trackEvent).toHaveBeenCalledWith('capsule.browse_opened', {
      surface: 'palette',
      tier: 'free',
    });
  });

  it('the upgrade CTA pushes the upsell notice + feature.blocked', () => {
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-list-upsell-cta'));
    expect(pushUpsellNotice).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('feature.blocked', {
      entitlement: 'execution-history',
      tier: 'free',
    });
  });
});

describe('CapsuleListOverlay — ES tuteo', () => {
  it('renders the Spanish title under the es locale', async () => {
    await i18next.changeLanguage('es');
    seedTwoCapsules();
    render(<CapsuleListOverlay onClose={vi.fn()} />);
    expect(
      screen.getByRole('dialog', { name: 'Cápsulas de ejecución' })
    ).not.toBeNull();
    expect(
      screen.getAllByTestId('capsule-list-row-export')[0]!.getAttribute(
        'aria-label'
      )
    ).toBe('Exporta');
  });
});
