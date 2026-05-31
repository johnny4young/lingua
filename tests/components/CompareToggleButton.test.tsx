/**
 * RL-020 Slice 8 — CompareToggleButton render contract.
 *
 * Covers:
 *   - Disabled state when no comparator snapshot for the language.
 *   - Disabled state when snapshot's language doesn't match.
 *   - Enabled state when snapshot is relevant; click fires the
 *     telemetry event and flips the per-tab flag.
 *   - The pressed state mirrors `compareWithSnapshotEnabled`.
 */

import { render, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompareToggleButton } from '../../src/renderer/components/Editor/CompareToggleButton';
import { useResultStore } from '../../src/renderer/stores/resultStore';

const trackEventMock = vi.fn();
const setTabCompareEnabledMock = vi.fn();

interface MockTab {
  id: string;
  language: string;
  compareWithSnapshotEnabled?: boolean;
}

const editorState: {
  tabs: MockTab[];
  activeTabId: string | null;
  setTabCompareEnabled: typeof setTabCompareEnabledMock;
} = {
  tabs: [],
  activeTabId: null,
  setTabCompareEnabled: setTabCompareEnabledMock,
};

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: unknown) => unknown) =>
    selector ? selector(editorState) : editorState,
  getActiveTab: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.tabs.find((t) => t.id === s.activeTabId) ?? null,
  getActiveTabIndex: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.activeTabId == null ? -1 : s.tabs.findIndex((t) => t.id === s.activeTabId),
}));

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function setActiveTab(tab: MockTab | null): void {
  if (tab === null) {
    editorState.tabs = [];
    editorState.activeTabId = null;
    return;
  }
  editorState.tabs = [tab];
  editorState.activeTabId = tab.id;
}

function setSnapshot(language: string): void {
  const snapshot = {
    lineResults: [],
    fullOutput: '',
    stdinConsumed: null,
    executionTime: 5,
    language,
    capturedAt: 1,
  };
  useResultStore.setState({
    lastSuccessfulSnapshot: snapshot,
    snapshotRing: [snapshot],
  });
}

describe('RL-020 Slice 8 — <CompareToggleButton>', () => {
  beforeEach(() => {
    trackEventMock.mockReset();
    setTabCompareEnabledMock.mockReset();
    setActiveTab({ id: 'tab-1', language: 'javascript' });
    useResultStore.setState({
      lastSuccessfulSnapshot: null,
      snapshotRing: [],
    });
  });

  it('renders disabled when no snapshot is available', () => {
    const { container } = render(<CompareToggleButton />);
    const button = container.querySelector('[data-testid="compare-toggle"]');
    expect(button?.getAttribute('disabled')).toBe('');
    expect(button?.getAttribute('data-state')).toBe('disabled');
  });

  it('renders disabled when the snapshot language differs', () => {
    setSnapshot('python');
    const { container } = render(<CompareToggleButton />);
    expect(
      container
        .querySelector('[data-testid="compare-toggle"]')
        ?.getAttribute('data-state')
    ).toBe('disabled');
  });

  it('renders enabled (off) when snapshot matches', () => {
    setSnapshot('javascript');
    const { container } = render(<CompareToggleButton />);
    const button = container.querySelector('[data-testid="compare-toggle"]');
    expect(button?.getAttribute('disabled')).toBeNull();
    expect(button?.getAttribute('data-state')).toBe('off');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
  });

  it('flips per-tab flag and fires telemetry on click', () => {
    setSnapshot('javascript');
    const { container } = render(<CompareToggleButton />);
    const button = container.querySelector('[data-testid="compare-toggle"]');
    if (!button) throw new Error('button not rendered');
    fireEvent.click(button);
    expect(setTabCompareEnabledMock).toHaveBeenCalledWith('tab-1', true);
    expect(trackEventMock).toHaveBeenCalledWith(
      'runtime.compare_view_toggled',
      { language: 'javascript', enabled: true }
    );
  });

  it('renders the on state with aria-pressed when the flag is already true', () => {
    setActiveTab({
      id: 'tab-1',
      language: 'javascript',
      compareWithSnapshotEnabled: true,
    });
    setSnapshot('javascript');
    const { container } = render(<CompareToggleButton />);
    const button = container.querySelector('[data-testid="compare-toggle"]');
    expect(button?.getAttribute('data-state')).toBe('on');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('does nothing when clicked while disabled', () => {
    const { container } = render(<CompareToggleButton />);
    const button = container.querySelector('[data-testid="compare-toggle"]');
    if (!button) throw new Error('button not rendered');
    fireEvent.click(button);
    expect(setTabCompareEnabledMock).not.toHaveBeenCalled();
    expect(trackEventMock).not.toHaveBeenCalled();
  });
});
